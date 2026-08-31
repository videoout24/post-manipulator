import { randomBytes } from "../core/Random.js?v=1.5.9";

const TARGETS_KEY = "publicationTargets";
const SESSION_KEY = "publicationTargetBinding";
const CHAT_TYPES = new Set(["channel", "group", "supergroup"]);

export class PublicationTargetService {
  constructor({ db, events = null, client, previewChannelBinding = null } = {}) {
    this.db = db;
    this.events = events;
    this.client = client;
    this.previewChannelBinding = previewChannelBinding;
  }

  async list() {
    const targets = await this.db.get("bindings", TARGETS_KEY, []);
    if (!Array.isArray(targets)) return [];
    const linkedDiscussionIds = new Set(
      targets.filter(item => item?.type === "channel" && item.linkedDiscussionChatId)
        .map(item => Number(item.linkedDiscussionChatId))
    );
    return targets
      .filter(item => !(item?.type === "group" && linkedDiscussionIds.has(Number(item.chatId))))
      .map(item => structuredClone(item));
  }

  getSession() { return this.db.get("runtime", SESSION_KEY, null); }

  async startBinding({ ttlMs = 30 * 60 * 1000 } = {}) {
    const session = {
      status: "waiting_code",
      code: `CONNECT-${randomCode(10)}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };
    await this.db.put("runtime", SESSION_KEY, session);
    this.events?.emit("telegram:publication-binding", session);
    return session;
  }

  async cancelBinding() {
    await this.db.delete("runtime", SESSION_KEY);
    this.events?.emit("telegram:publication-binding", { status: "idle" });
  }

  async handleMyChatMember(update) {
    const change = update?.my_chat_member;
    if (!CHAT_TYPES.has(change?.chat?.type)) return false;
    if (await this.#isPreviewChannel(change.chat.id)) return false;

    const membership = publicationAvailability(change.new_chat_member, change.chat.type);
    if (!membership.admin) {
      const existing = (await this.list()).find(item => Number(item.chatId) === Number(change.chat.id));
      if (!existing) return false;
      await this.#save({
        ...existing,
        status: "unavailable",
        reason: membership.reason,
        rights: membership.rights,
        checkedAt: Date.now()
      });
      return true;
    }

    await this.refresh(change.chat.id, { chatHint: change.chat, memberHint: change.new_chat_member, discoveredBy: "my_chat_member" });
    return true;
  }

  async handleMessage(update) {
    const message = update?.channel_post || update?.message;
    if (!CHAT_TYPES.has(message?.chat?.type) || typeof message?.text !== "string") return false;
    if (await this.#isPreviewChannel(message.chat.id)) return false;
    const session = await this.#activeSession();
    if (!session || message.text.trim() !== session.code) return false;

    const target = await this.refresh(message.chat.id, { chatHint: message.chat, discoveredBy: "confirmation_code" });
    if (target.status !== "ready") throw new Error(`Бот не готов к публикации: ${target.reason}`);
    await this.client.deleteMessage(message.chat.id, message.message_id).catch(() => {});
    await this.db.delete("runtime", SESSION_KEY);
    this.events?.emit("telegram:publication-binding", { status: "bound", target });
    return true;
  }

  async refresh(chatId, { chatHint = null, memberHint = null, discoveredBy = "refresh" } = {}) {
    if (await this.#isPreviewChannel(chatId)) throw new Error("Канал предпросмотра нельзя добавить в Публикации");
    const bot = await this.client.getMe();
    const [chat, member, memberCount] = await Promise.all([
      this.client.getChat(chatId).catch(() => chatHint),
      memberHint ? Promise.resolve(memberHint) : this.client.getChatMember(chatId, bot.id),
      this.client.getChatMemberCount(chatId).catch(() => null)
    ]);
    if (!CHAT_TYPES.has(chat?.type)) throw new Error("Поддерживаются только каналы и группы");
    const availability = publicationAvailability(member, chat.type);
    let discussionRights = null;
    let discussionChat = null;
    let discussionMember = null;
    if (chat.type === "channel" && chat.linked_chat_id) {
      [discussionMember, discussionChat] = await Promise.all([
        this.client.getChatMember(chat.linked_chat_id, bot.id).catch(() => null),
        this.client.getChat(chat.linked_chat_id).catch(() => null)
      ]);
      const discussionAvailability = publicationAvailability(discussionMember || {}, "supergroup");
      discussionRights = {
        status: discussionMember?.status || "unknown",
        canDelete: discussionAvailability.admin && discussionAvailability.rights.delete === true
      };
    }
    const target = {
      chatId: Number(chat.id),
      type: chat.type === "channel" ? "channel" : "group",
      telegramType: chat.type,
      title: chat.title || chatHint?.title || String(chat.id),
      username: chat.username || "",
      visibility: chat.type === "channel" ? (chat.username ? "public" : "private") : null,
      status: availability.ready ? "ready" : "unavailable",
      reason: availability.reason,
      rights: availability.rights,
      memberCount: Number.isFinite(Number(memberCount)) ? Number(memberCount) : null,
      linkedDiscussionChatId: chat.type === "channel" && chat.linked_chat_id ? Number(chat.linked_chat_id) : null,
      linkedDiscussionUsername: discussionChat?.username || "",
      linkedDiscussionTitle: discussionChat?.title || "",
      linkedChannelChatId: chat.type !== "channel" && chat.linked_chat_id ? Number(chat.linked_chat_id) : null,
      commentsEnabled: chat.type === "channel" && Boolean(chat.linked_chat_id),
      discussionRights,
      discoveredBy,
      checkedAt: Date.now()
    };
    if (target.type === "group" && target.linkedChannelChatId) {
      await this.#attachDiscussionGroup(target);
      return { ...target, status: "attached", reason: "linked_discussion_group" };
    }
    await this.#save(target);
    return target;
  }

  async remove(chatId) {
    const targets = (await this.list()).filter(item => Number(item.chatId) !== Number(chatId));
    await this.db.put("bindings", TARGETS_KEY, targets);
    this.events?.emit("telegram:publication-targets", targets);
  }

  async #save(target) {
    let targets = await this.list();
    if (target.type === "channel" && target.linkedDiscussionChatId) {
      targets = targets.filter(item => Number(item.chatId) !== Number(target.linkedDiscussionChatId));
    }
    const index = targets.findIndex(item => Number(item.chatId) === Number(target.chatId));
    if (index >= 0) targets[index] = target;
    else targets.push(target);
    await this.db.put("bindings", TARGETS_KEY, targets);
    this.events?.emit("telegram:publication-targets", targets);
    return target;
  }

  async #attachDiscussionGroup(group) {
    let targets = await this.list();
    targets = targets.filter(item => Number(item.chatId) !== Number(group.chatId));
    const channelIndex = targets.findIndex(item =>
      item.type === "channel"
      && (Number(item.chatId) === Number(group.linkedChannelChatId)
        || Number(item.linkedDiscussionChatId) === Number(group.chatId))
    );
    if (channelIndex >= 0) {
      targets[channelIndex] = {
        ...targets[channelIndex],
        linkedDiscussionChatId: Number(group.chatId),
        linkedDiscussionUsername: group.username || "",
        linkedDiscussionTitle: group.title || "",
        discussionRights: {
          status: group.rights ? "administrator" : "unknown",
          canDelete: group.rights?.delete === true
        },
        commentsEnabled: true,
        checkedAt: Date.now()
      };
    }
    await this.db.put("bindings", TARGETS_KEY, targets);
    this.events?.emit("telegram:publication-targets", targets);
  }

  async #isPreviewChannel(chatId) {
    const [slot, session] = await Promise.all([
      this.previewChannelBinding?.getSlot?.(),
      this.previewChannelBinding?.getSession?.()
    ]);
    const matches = Boolean(
      (slot?.chatId && Number(slot.chatId) === Number(chatId))
      || (session?.candidate?.chatId && Number(session.candidate.chatId) === Number(chatId))
    );
    if (matches) {
      const targets = await this.list();
      if (targets.some(item => Number(item.chatId) === Number(chatId))) {
        await this.db.put("bindings", TARGETS_KEY, targets.filter(item => Number(item.chatId) !== Number(chatId)));
      }
    }
    return matches;
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

export function publicationAvailability(member = {}, chatType = "channel") {
  const admin = member?.status === "administrator" || member?.status === "creator";
  const rights = chatType === "channel" ? {
    post: member?.status === "creator" || member?.can_post_messages === true,
    edit: member?.status === "creator" || member?.can_edit_messages === true,
    delete: member?.status === "creator" || member?.can_delete_messages === true
  } : {
    send: admin,
    delete: member?.status === "creator" || member?.can_delete_messages === true,
    pin: member?.status === "creator" || member?.can_pin_messages === true
  };
  const required = chatType === "channel" ? ["post"] : ["send"];
  const missing = required.filter(key => !rights[key]);
  return {
    admin,
    ready: admin && missing.length === 0,
    reason: !admin ? `bot_status_${member?.status || "unknown"}` : missing.length ? `missing_${missing.join("_")}` : "",
    rights
  };
}

function randomCode(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(length)].map(value => alphabet[value % alphabet.length]).join("");
}
