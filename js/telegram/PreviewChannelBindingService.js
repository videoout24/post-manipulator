import { t } from "../i18n/index.js?v=1.8.0";
import { randomBytes } from "../core/Random.js?v=1.5.9";

const SLOT_KEY = "previewChannel";
const SESSION_KEY = "previewChannelBinding";
const LIVE_MESSAGE_KEY = "liveMessage";
const AUTOMATIC_BINDING_RETRY_DELAYS_MS = Object.freeze([300, 900, 1800, 3000]);
const LIVE_PLACEHOLDER = Object.freeze({
  blocks: Object.freeze([
    Object.freeze({
      type: "paragraph",
      text: t("telegram.previewChannelBindingService.thePreviewOfTheCurrentMessageWill")
    })
  ])
});

export class PreviewChannelBindingService {
  constructor({ db, events, client, ownerBinding, automaticRetryDelays = AUTOMATIC_BINDING_RETRY_DELAYS_MS, delay = wait }) {
    this.db = db;
    this.events = events;
    this.client = client;
    this.ownerBinding = ownerBinding;
    this.automaticRetryDelays = [...(automaticRetryDelays || [])]
      .map(value => Math.max(0, Number(value) || 0));
    this.delay = delay;
  }

  getSlot() { return this.db.get("bindings", SLOT_KEY, { status: "empty" }); }
  getSession() { return this.db.get("runtime", SESSION_KEY, null); }

  async startBinding({ ttlMs = 30 * 60 * 1000 } = {}) {
    const owner = await this.ownerBinding.getOwner();
    if (!owner) throw new Error(t("telegram.previewChannelBindingService.bindTheOwnerFirst"));
    const slot = await this.getSlot();
    if (slot?.status === "bound" || slot?.status === "unavailable") {
      throw new Error(t("telegram.previewChannelBindingService.thePreviewChannelSlotIsAlreadyOccupied"));
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
      const automatic = await this.#verifyAutomaticCandidateWithRetry(change.chat, owner, change.new_chat_member);
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
      title: change.chat.title || t("security.common.privateChannel"),
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
    if (post.chat.username) throw new Error(t("telegram.previewChannelBindingService.theProjectPreviewChannelMustBePrivate"));
    if (session.candidate && Number(session.candidate.chatId) !== Number(post.chat.id)) return false;

    const verified = await this.#verifyBotRights(post.chat.id);
    if (!verified.ok) throw new Error(t("telegram.previewChannelBindingService.theBotDoesNotHaveEnoughPermissions", { 0: verified.reason }));

    try { await this.client.deleteMessage(post.chat.id, post.message_id); }
    catch { /* confirmation post cleanup is best effort */ }

    await this.#bindChannel({
      ...post.chat,
      title: post.chat.title || session.candidate?.title || t("html.previewChannel")
    }, verified.rights, { source: "confirmation_code" });
    return true;
  }

  async #bindChannel(chat, rights, { source, memberCount = null } = {}) {
    const previewMessage = await this.#createPinnedLivePreview(chat.id);
    const bound = {
      status: "bound",
      chatId: Number(chat.id),
      title: chat.title || t("html.previewChannel"),
      boundAt: Date.now(),
      checkedAt: Date.now(),
      rights,
      source: source || "confirmation_code",
      ...(Number.isSafeInteger(memberCount) ? { memberCount } : {})
    };
    await Promise.all([
      this.db.put("bindings", SLOT_KEY, bound),
      this.db.put("settings", "livePreviewEnabled", true),
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
    this.events?.emit("telegram:live-preview-setting", { enabled: true });
    this.events?.emit("telegram:preview-channel", bound);
    this.events?.emit("telegram:preview-status", {
      state: "ready",
      message: t("telegram.previewChannelBindingService.thePinnedLivePreviewMessageIsCreated"),
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

  async #verifyAutomaticCandidateWithRetry(updateChat, owner, observedBotMember) {
    let result = null;
    for (let attempt = 0; attempt <= this.automaticRetryDelays.length; attempt += 1) {
      if (attempt > 0) await this.delay(this.automaticRetryDelays[attempt - 1]);
      const slot = await this.getSlot();
      if (slot?.status === "bound" || slot?.status === "unavailable") {
        return { ok: false, reason: "slot_filled" };
      }
      try {
        result = await this.#verifyAutomaticCandidate(updateChat, owner, observedBotMember);
      } catch (error) {
        result = { ok: false, reason: "verification_error", error };
      }
      if (result.ok || !isRetryableAutomaticCandidate(result)) return result;
    }
    return result || { ok: false, reason: "verification_failed" };
  }

  async #verifyAutomaticCandidate(updateChat, owner, observedBotMember = null) {
    const chatId = Number(updateChat?.id || 0);
    if (!chatId || !owner?.userId) return { ok: false, reason: "invalid_candidate" };

    const botMemberPromise = observedBotMember
      ? Promise.resolve(observedBotMember)
      : this.client.getMe().then(bot => this.client.getChatMember(chatId, bot.id));
    const [chat, botMember, ownerMember, memberCount] = await Promise.all([
      this.client.getChat(chatId),
      botMemberPromise,
      this.client.getChatMember(chatId, Number(owner.userId)),
      this.client.getChatMemberCount(chatId)
    ]);
    if (chat?.type !== "channel") return { ok: false, reason: "not_channel" };
    if (chat.username) return { ok: false, reason: "public_channel" };

    const availability = channelMemberAvailability(botMember);
    if (!availability.ok) return { ok: false, reason: availability.reason };
    if (!isPresentMember(ownerMember)) return { ok: false, reason: "owner_not_member" };
    const numericMemberCount = Number(memberCount);
    if (numericMemberCount !== 2) {
      return { ok: false, reason: numericMemberCount < 2 || !Number.isFinite(numericMemberCount)
        ? "member_count_pending"
        : "member_count_not_two" };
    }

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

function isRetryableAutomaticCandidate(result) {
  return result?.reason === "member_count_pending"
    || result?.reason === "owner_not_member"
    || result?.reason === "verification_error";
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
}

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return [...bytes].map(value => alphabet[value % alphabet.length]).join("");
}
