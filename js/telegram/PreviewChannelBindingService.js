import { randomBytes } from "../core/Random.js?v=1.5.9";

const SLOT_KEY = "previewChannel";
const SESSION_KEY = "previewChannelBinding";
const LIVE_MESSAGE_KEY = "liveMessage";
const LIVE_PLACEHOLDER = Object.freeze({
  blocks: Object.freeze([
    Object.freeze({
      type: "paragraph",
      text: "Предпросмотр текущего сообщения появится здесь после включения синхронизации."
    })
  ])
});

export class PreviewChannelBindingService {
  constructor({ db, events, client, ownerBinding }) {
    this.db = db;
    this.events = events;
    this.client = client;
    this.ownerBinding = ownerBinding;
  }

  getSlot() { return this.db.get("bindings", SLOT_KEY, { status: "empty" }); }
  getSession() { return this.db.get("runtime", SESSION_KEY, null); }

  async startBinding({ ttlMs = 30 * 60 * 1000 } = {}) {
    const owner = await this.ownerBinding.getOwner();
    if (!owner) throw new Error("Сначала привяжите владельца");
    const slot = await this.getSlot();
    if (slot?.status === "bound" || slot?.status === "unavailable") {
      throw new Error("Слот канала предпросмотра уже занят. Сначала отвяжите текущий канал.");
    }
    const session = {
      status: "binding",
      code: `PREVIEW-${randomCode(8)}`,
      candidate: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };
    await this.db.put("runtime", SESSION_KEY, session);
    this.events?.emit("telegram:channel-binding", session);
    return session;
  }

  async cancelBinding() {
    await this.db.delete("runtime", SESSION_KEY);
    this.events?.emit("telegram:channel-binding", { status: "idle" });
  }

  async unbind() {
    await this.db.put("bindings", SLOT_KEY, { status: "empty" });
    await this.db.put("settings", "livePreviewEnabled", false);
    await this.db.delete("runtime", SESSION_KEY);
    await this.db.delete("preview", "liveMessage");
    this.events?.emit("telegram:live-preview-setting", { enabled: false });
    this.events?.emit("telegram:preview-channel", { status: "empty" });
  }

  async markUnavailable(reason = "unknown", error = null) {
    const slot = await this.getSlot();
    if (!slot?.chatId || (slot.status !== "bound" && slot.status !== "unavailable")) return slot;
    const next = {
      ...slot,
      status: "unavailable",
      reason,
      lastError: error ? { message: error.message || String(error), code: error.errorCode || 0 } : null,
      checkedAt: Date.now()
    };
    await this.db.put("bindings", SLOT_KEY, next);
    await this.db.put("settings", "livePreviewEnabled", false);
    this.events?.emit("telegram:live-preview-setting", { enabled: false });
    this.events?.emit("telegram:preview-channel", next);
    return next;
  }

  async handleMyChatMember(update) {
    const change = update?.my_chat_member;
    if (!change || change.chat?.type !== "channel") return false;

    const slot = await this.getSlot();
    if ((slot.status === "bound" || slot.status === "unavailable") && Number(change.chat.id) === Number(slot.chatId)) {
      const availability = channelMemberAvailability(change.new_chat_member);
      const next = {
        ...slot,
        status: availability.ok ? "bound" : "unavailable",
        reason: availability.ok ? "" : availability.reason,
        checkedAt: Date.now()
      };
      await this.db.put("bindings", SLOT_KEY, next);
      this.events?.emit("telegram:preview-channel", next);
      return true;
    }

    // Filled slot: discovery is completely disabled for every other channel.
    if (slot.status === "bound" || slot.status === "unavailable") return false;

    // A dedicated private channel can be safely recognized without a
    // confirmation code. Verify every condition against the Bot API instead
    // of trusting only the update: no public username, the current owner is a
    // member, the bot has all preview rights, and they are its only members.
    const owner = await this.ownerBinding.getOwner();
    if (owner && channelMemberAvailability(change.new_chat_member).ok) {
      const automatic = await this.#verifyAutomaticCandidate(change.chat, owner);
      if (automatic.ok) {
        await this.#bindChannel(automatic.chat, automatic.rights, {
          source: "private_owner_pair",
          memberCount: automatic.memberCount
        });
        return true;
      }
    }

    const session = await this.#activeSession();
    if (!session) return false;

    // The project preview slot accepts private channels only.
    if (change.chat.username) {
      this.events?.emit("telegram:channel-binding-rejected", { reason: "public_channel", chat: change.chat });
      return true;
    }

    const actorId = Number(change.from?.id || 0);
    if (owner && actorId && actorId !== Number(owner.userId)) return false;

    const availability = channelMemberAvailability(change.new_chat_member);
    if (!availability.ok) {
      this.events?.emit("telegram:channel-binding-rejected", { reason: availability.reason, chat: change.chat });
      return true;
    }

    const candidate = {
      chatId: Number(change.chat.id),
      title: change.chat.title || "Private channel",
      detectedAt: Date.now(),
      rights: availability.rights
    };
    const nextSession = { ...session, candidate, status: "waiting_confirmation" };
    await this.db.put("runtime", SESSION_KEY, nextSession);
    this.events?.emit("telegram:channel-binding", nextSession);
    return true;
  }

  async handleChannelPost(update) {
    const post = update?.channel_post;
    if (!post || post.chat?.type !== "channel" || typeof post.text !== "string") return false;

    const slot = await this.getSlot();
    if (slot.status === "bound" || slot.status === "unavailable") return false;

    const session = await this.#activeSession();
    if (!session || post.text.trim() !== session.code) return false;
    if (post.chat.username) throw new Error("Канал предпросмотра проекта должен быть приватным");
    if (session.candidate && Number(session.candidate.chatId) !== Number(post.chat.id)) return false;

    const verified = await this.#verifyBotRights(post.chat.id);
    if (!verified.ok) throw new Error(`Недостаточно прав бота в канале: ${verified.reason}`);

    try { await this.client.deleteMessage(post.chat.id, post.message_id); }
    catch { /* confirmation post cleanup is best effort */ }

    await this.#bindChannel({
      ...post.chat,
      title: post.chat.title || session.candidate?.title || "Preview channel"
    }, verified.rights, { source: "confirmation_code" });
    return true;
  }

  async #bindChannel(chat, rights, { source, memberCount = null } = {}) {
    const previewMessage = await this.#createPinnedLivePreview(chat.id);
    const bound = {
      status: "bound",
      chatId: Number(chat.id),
      title: chat.title || "Preview channel",
      boundAt: Date.now(),
      checkedAt: Date.now(),
      rights,
      source: source || "confirmation_code",
      ...(Number.isSafeInteger(memberCount) ? { memberCount } : {})
    };
    await Promise.all([
      this.db.put("bindings", SLOT_KEY, bound),
      this.db.put("preview", LIVE_MESSAGE_KEY, {
        chatId: bound.chatId,
        messageId: Number(previewMessage.message_id),
        hash: "",
        mode: "provisioned",
        pinned: true,
        syncedAt: Date.now()
      }),
      this.db.delete("runtime", SESSION_KEY)
    ]);
    this.events?.emit("telegram:preview-channel", bound);
    this.events?.emit("telegram:preview-status", {
      state: "ready",
      message: "Закреплённое сообщение live-preview создано в канале",
      preview: await this.db.get("preview", LIVE_MESSAGE_KEY, null)
    });
    return bound;
  }

  async #createPinnedLivePreview(chatId) {
    const message = await this.client.sendRichMessage({
      chatId: Number(chatId),
      richMessage: LIVE_PLACEHOLDER,
      disableNotification: true
    });
    try {
      await this.client.pinChatMessage(Number(chatId), Number(message.message_id), { disableNotification: true });
      return message;
    } catch (error) {
      // Do not leave an unpinned duplicate behind when the confirmation code is retried.
      await this.client.deleteMessage(Number(chatId), Number(message.message_id)).catch(() => {});
      throw error;
    }
  }

  async #verifyBotRights(chatId) {
    const bot = await this.client.getMe();
    const member = await this.client.getChatMember(chatId, bot.id);
    return channelMemberAvailability(member);
  }

  async #verifyAutomaticCandidate(updateChat, owner) {
    const chatId = Number(updateChat?.id || 0);
    if (!chatId || !owner?.userId) return { ok: false, reason: "invalid_candidate" };

    const [bot, chat] = await Promise.all([
      this.client.getMe(),
      this.client.getChat(chatId)
    ]);
    if (chat?.type !== "channel") return { ok: false, reason: "not_channel" };
    if (chat.username) return { ok: false, reason: "public_channel" };

    const [botMember, ownerMember, memberCount] = await Promise.all([
      this.client.getChatMember(chatId, bot.id),
      this.client.getChatMember(chatId, Number(owner.userId)),
      this.client.getChatMemberCount(chatId)
    ]);
    const availability = channelMemberAvailability(botMember);
    if (!availability.ok) return { ok: false, reason: availability.reason };
    if (!isPresentMember(ownerMember)) return { ok: false, reason: "owner_not_member" };
    if (Number(memberCount) !== 2) return { ok: false, reason: "member_count_not_two" };

    return {
      ok: true,
      chat,
      rights: availability.rights,
      memberCount: Number(memberCount)
    };
  }

  async #activeSession() {
    const session = await this.getSession();
    if (!session) return null;
    if (session.expiresAt && session.expiresAt < Date.now()) {
      await this.cancelBinding();
      return null;
    }
    return session;
  }
}

function channelMemberAvailability(member = {}) {
  const status = member?.status;
  if (status === "creator") return { ok: true, rights: { post: true, edit: true, delete: true } };
  if (status !== "administrator") return { ok: false, reason: `bot_status_${status || "unknown"}`, rights: {} };

  const rights = {
    post: member.can_post_messages === true,
    edit: member.can_edit_messages === true,
    delete: member.can_delete_messages === true
  };
  const missing = Object.entries(rights).filter(([, ok]) => !ok).map(([name]) => name);
  return missing.length
    ? { ok: false, reason: `missing_${missing.join("_")}`, rights }
    : { ok: true, rights };
}

function isPresentMember(member = {}) {
  return ["creator", "administrator", "member", "restricted"].includes(member?.status);
}

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return [...bytes].map(value => alphabet[value % alphabet.length]).join("");
}
