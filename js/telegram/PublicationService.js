import { randomUUID } from "../core/Random.js?v=1.5.9";
import { materializeRelationUrl, relationIdsInAst, removeLinkRelationFromAst } from "../links/LinkRelationAst.js?v=1.5.9";

export const PUBLICATION_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const PENDING_FORWARD_PREFIX = "publicationForward:";

export class PublicationService {
  constructor({ db, events = null, client, renderer, validator, targets, drafts, draftSession = null, documents = null, linkRelations = null } = {}) {
    Object.assign(this, { db, events, client, renderer, validator, targets, drafts, draftSession, documents, linkRelations });
    this.linkUnsubscribe = this.events?.on?.("links:changed", event => {
      if (event?.reason !== "removed" || event?.relation?.source?.kind !== "publication") return;
      this.#removeRelationFromPublishedSource(event.relation).catch(error => {
        this.events?.emit?.("ui:toast", { message: `Не удалось обновить отвязанную публикацию: ${error?.message || error}`, type: "error" });
      });
    });
    this.projectPublicationUnsubscribe = this.events?.on?.("telegram:project-publication-record", record => {
      this.#reconcilePendingForward(record).catch(error => {
        this.events?.emit?.("telegram:publication-discussion-error", { record, error });
      });
    });
  }

  stop() {
    this.linkUnsubscribe?.();
    this.linkUnsubscribe = null;
    this.projectPublicationUnsubscribe?.();
    this.projectPublicationUnsubscribe = null;
  }

  async list() {
    const rows = await this.db.all("publications");
    return rows.map(row => row.value)
      .sort((a, b) => Number(b.publishedAt || b.scheduledAt || 0) - Number(a.publishedAt || a.scheduledAt || 0));
  }

  async publishDraft(draftId, targetChatId, { commentsEnabled = true } = {}) {
    const [draft, target] = await Promise.all([
      this.drafts.get(draftId),
      this.targets.list().then(rows => rows.find(item => Number(item.chatId) === Number(targetChatId)))
    ]);
    if (!draft) throw new Error("Черновик не найден");
    if (!draft.messageAst?.children?.length) throw new Error("Пустой черновик нельзя опубликовать");
    if (!target || target.status !== "ready") throw new Error("Канал или группа недоступны для публикации");
    if (target.type === "channel" && target.commentsEnabled && commentsEnabled === false && !target.discussionRights?.canDelete) {
      throw new Error("Для отключения комментариев боту нужно право удаления сообщений в группе обсуждения");
    }
    const publishAst = await this.linkRelations?.materializeAst?.(draft.messageAst) || draft.messageAst;
    const tree = astTree(publishAst);
    const errors = this.validator.validate(tree);
    if (errors.length) throw new Error(errors.join("; "));
    const envelope = this.renderer.renderEnvelope(tree);
    const message = await this.client.sendRichMessage({
      chatId: target.chatId,
      richMessage: envelope.richMessage,
      replyMarkup: envelope.replyMarkup,
      disableNotification: false
    });
    const publishedAt = Number(message.date || Math.floor(Date.now() / 1000)) * 1000;
    const record = {
      id: `publication_${randomUUID()}`,
      source: { kind: "draft", draftId: draft.id, title: draft.title },
      messageAst: structuredClone(publishAst),
      target: structuredClone(target),
      chatId: Number(target.chatId),
      messageId: Number(message.message_id),
      publishedAt,
      deleteUntil: publishedAt + PUBLICATION_DELETE_WINDOW_MS,
      commentsEnabled: target.type === "channel" && target.commentsEnabled && Boolean(commentsEnabled),
      discussionChatId: target.linkedDiscussionChatId || null,
      discussionUsername: target.linkedDiscussionUsername || "",
      discussionMessageId: null,
      commentsDisabled: false,
      pinned: false,
      pinnedAt: null,
      commentMessageIds: [],
      commentCount: 0,
      reactionCount: 0,
      reactions: [],
      reactionActors: {}
    };
    await this.db.put("publications", record.id, record);
    await this.linkRelations?.bindSourceDraftToPublication?.(draft.id, record.id);
    const resolvedRelations = await this.linkRelations?.resolveWaitingForPublication?.(record) || [];
    await this.#applyResolvedRelations(resolvedRelations);
    if (this.documents?.clearPublishedDraft) await this.documents.clearPublishedDraft(draft.id);
    else if (this.draftSession?.activeDraftId === draft.id) {
      await this.draftSession.deactivate({ flush: false, reason: "published" });
    }
    await this.drafts.delete(draft.id);
    this.events?.emit("telegram:publication-created", record);
    this.events?.emit("telegram:publications-changed", await this.list());
    // An automatic forward may have reached polling before sendRichMessage returned.
    // Reconcile it in the background: discussion housekeeping must never keep the
    // publish dialog disabled after the production message was already accepted.
    this.#reconcilePendingForward(record).catch(error => {
      this.events?.emit("telegram:publication-discussion-error", { record, error });
    });
    return record;
  }

  async #reconcilePendingForward(record) {
    const pendingKey = `${PENDING_FORWARD_PREFIX}${record.chatId}:${record.messageId}`;
    const pendingForward = await this.db.get("runtime", pendingKey, null);
    if (!pendingForward) return false;
    await this.#handleAutomaticForward(pendingForward);
    await this.db.delete("runtime", pendingKey);
    return true;
  }

  async setPinned(recordId, pinned) {
    const record = await this.db.get("publications", recordId, null);
    if (!record) throw new Error("Публикация не найдена");
    if (record.scheduledAt || !record.chatId || !record.messageId) {
      throw new Error("Можно закрепить только опубликованный пост");
    }
    const nextPinned = Boolean(pinned);
    if (nextPinned === Boolean(record.pinned)) return structuredClone(record);
    if (nextPinned && record.commentsEnabled && (!record.discussionChatId || !record.discussionMessageId)) {
      throw new Error("Дождитесь появления сообщения в группе обсуждения");
    }

    const messages = [{ chatId: record.chatId, messageId: record.messageId }];
    if (record.commentsEnabled && record.discussionChatId && record.discussionMessageId) {
      messages.push({ chatId: record.discussionChatId, messageId: record.discussionMessageId });
    }
    const changed = [];
    try {
      for (const message of messages) {
        await this.#setMessagePinned(message, nextPinned);
        changed.push(message);
      }
    } catch (error) {
      for (const message of changed.reverse()) {
        await this.#setMessagePinned(message, !nextPinned).catch(() => {});
      }
      throw new Error(`Не удалось синхронизировать закрепление поста и комментариев: ${error?.message || error}`);
    }
    record.pinned = nextPinned;
    record.pinnedAt = nextPinned ? Date.now() : null;
    await this.db.put("publications", record.id, record);
    this.events?.emit("telegram:publication-updated", structuredClone(record));
    this.events?.emit("telegram:publications-changed", await this.list());
    return structuredClone(record);
  }

  async #setMessagePinned({ chatId, messageId }, pinned) {
    if (pinned) {
      return this.client.pinChatMessage(chatId, messageId, { disableNotification: true });
    }
    return this.client.unpinChatMessage(chatId, messageId);
  }

  async delete(recordId) {
    const record = await this.db.get("publications", recordId, null);
    if (!record) return false;
    if (!isPublicationDeleteAvailable(record)) {
      throw new Error("48-часовой срок удаления публикации в Telegram истёк");
    }
    try {
      await this.client.deleteMessage(record.chatId, record.messageId);
    } catch (error) {
      // The message may have been deleted directly in Telegram. Its production
      // state is already gone, so keeping a local publication card would only
      // leave the user with an undeletable stale projection.
      if (!error?.isMessageMissing?.()) throw error;
    }
    await this.db.delete("publications", recordId);
    this.events?.emit("telegram:publications-changed", await this.list());
    return true;
  }

  async checkExpiredDeletion(recordId) {
    const record = await this.db.get("publications", recordId, null);
    if (!record) throw new Error("Публикация не найдена");
    if (isPublicationDeleteAvailable(record)) throw new Error("Для этой публикации ещё доступно обычное удаление");
    try {
      await this.client.deleteMessage(record.chatId, record.messageId);
    } catch (error) {
      if (error?.isMessageMissing?.()) return { record, remoteState: "missing" };
      if (error?.isMessageDeleteForbidden?.()) return { record, remoteState: "present" };
      throw error;
    }
    await this.discardLocal(record.id);
    return { record, remoteState: "deleted" };
  }

  async discardLocal(recordId) {
    const record = await this.db.get("publications", recordId, null);
    if (!record) return false;
    await this.db.delete("publications", recordId);
    this.events?.emit("telegram:publications-changed", await this.list());
    return true;
  }

  async createEditDraft(recordId) {
    const record = await this.db.get("publications", recordId, null);
    if (!record) throw new Error("Публикация не найдена");
    if (!record.messageAst?.children) throw new Error("Для этой старой публикации нет локальной копии содержимого");
    const existing = (await this.drafts.list()).find(draft =>
      draft.source?.kind === "publication" && draft.source?.publicationId === record.id
    );
    if (existing) return existing;
    return this.drafts.create({
      title: `${record.source?.title || "Публикация"} · редактирование`,
      messageAst: record.messageAst,
      source: {
        kind: "publication",
        publicationId: record.id,
        chatId: record.chatId,
        messageId: record.messageId,
        targetTitle: record.target?.title || ""
      }
    });
  }

  async applyDraftChanges(draftId) {
    const draft = await this.drafts.get(draftId);
    const publicationId = draft?.source?.kind === "publication" ? draft.source.publicationId : null;
    if (!draft || !publicationId) throw new Error("Черновик не связан с публикацией");
    const record = await this.db.get("publications", publicationId, null);
    if (!record) throw new Error("Исходная публикация не найдена");
    const appliedAst = await this.linkRelations?.materializeAst?.(draft.messageAst) || draft.messageAst;
    const tree = astTree(appliedAst);
    const errors = this.validator.validate(tree);
    if (errors.length) throw new Error(errors.join("; "));
    const envelope = this.renderer.renderEnvelope(tree);
    await this.client.editRichMessage({
      chatId: record.chatId,
      messageId: record.messageId,
      richMessage: envelope.richMessage,
      replyMarkup: envelope.replyMarkup
    });
    record.messageAst = structuredClone(appliedAst);
    record.editedAt = Date.now();
    await this.db.put("publications", record.id, record);
    this.events?.emit("telegram:publication-updated", record);
    this.events?.emit("telegram:publications-changed", await this.list());
    return record;
  }

  async #applyResolvedRelations(relations) {
    for (const relation of relations) {
      if (relation.source?.kind !== "publication" || !relation.source?.id) continue;
      const source = await this.db.get("publications", relation.source.id, null);
      if (!source?.chatId || !source?.messageId || !source.messageAst) continue;
      try {
        const nextAst = materializeRelationUrl(source.messageAst, relation.id, relation.resolvedUrl);
        const envelope = this.renderer.renderEnvelope(astTree(nextAst));
        await this.client.editRichMessage({ chatId: source.chatId, messageId: source.messageId, richMessage: envelope.richMessage, replyMarkup: envelope.replyMarkup });
        source.messageAst = nextAst;
        source.editedAt = Date.now();
        await this.db.put("publications", source.id, source);
        await this.linkRelations.markApplied(relation.id);
      } catch (error) {
        await this.linkRelations.markFailed(relation.id, error);
      }
    }
  }

  async #removeRelationFromPublishedSource(relation) {
    const sourceId = relation?.source?.id;
    if (!sourceId || !relation?.id) return false;
    const source = await this.db.get("publications", sourceId, null);
    if (!source?.chatId || !source?.messageId || !source.messageAst) return false;
    if (!relationIdsInAst(source.messageAst).includes(String(relation.id))) return false;
    const nextAst = removeLinkRelationFromAst(source.messageAst, relation.id);
    const envelope = this.renderer.renderEnvelope(astTree(nextAst));
    await this.client.editRichMessage({
      chatId: source.chatId,
      messageId: source.messageId,
      richMessage: envelope.richMessage,
      replyMarkup: envelope.replyMarkup
    });
    source.messageAst = nextAst;
    source.editedAt = Date.now();
    await this.db.put("publications", source.id, source);
    this.events?.emit("telegram:publication-updated", source);
    this.events?.emit("telegram:publications-changed", await this.list());
    return true;
  }

  async handleUpdate(update) {
    if (update?.message_reaction_count) return this.#handleReactionCount(update.message_reaction_count);
    if (update?.message_reaction) return this.#handleReaction(update.message_reaction);
    const message = update?.message;
    if (!message) return false;
    if (message.is_automatic_forward) return this.#handleAutomaticForward(message);
    return this.#handleComment(message);
  }

  async #handleAutomaticForward(message) {
    const origin = message.forward_origin;
    const sourceChatId = Number(origin?.chat?.id || message.forward_from_chat?.id || message.sender_chat?.id || 0);
    const sourceMessageId = Number(origin?.message_id || message.forward_from_message_id || 0);
    if (!sourceChatId) return false;
    const records = await this.list();
    const record = records.find(item => item.chatId === sourceChatId && item.messageId === sourceMessageId)
      || (!sourceMessageId ? records.find(item =>
        item.chatId === sourceChatId
        && !item.discussionMessageId
        && Math.abs(Number(message.date || 0) * 1000 - Number(item.publishedAt || 0)) < 5 * 60 * 1000
      ) : null);
    if (!record) {
      if (!sourceMessageId) return false;
      await this.db.put("runtime", `${PENDING_FORWARD_PREFIX}${sourceChatId}:${sourceMessageId}`, message);
      return true;
    }
    record.discussionChatId = Number(message.chat?.id || record.discussionChatId || 0) || null;
    record.discussionMessageId = Number(message.message_id);
    if (!record.commentsEnabled) {
      await this.client.deleteMessage(record.discussionChatId, record.discussionMessageId);
      record.commentsDisabled = true;
    } else if (record.pinned) {
      // Legacy records or a forward received during an older app session may already
      // be pinned in the channel. Bring the newly discovered discussion message into
      // the same state as soon as Telegram exposes its identity.
      await this.#setMessagePinned({
        chatId: record.discussionChatId,
        messageId: record.discussionMessageId
      }, true);
    }
    await this.#save(record);
    return true;
  }

  async #handleComment(message) {
    const replyId = Number(message.reply_to_message?.message_id || 0);
    const threadId = Number(message.message_thread_id || 0);
    if (!replyId && !threadId) return false;
    const record = (await this.list()).find(item =>
      Number(item.discussionChatId) === Number(message.chat?.id)
      && [replyId, threadId].includes(Number(item.discussionMessageId))
    );
    if (!record || record.commentsDisabled) return false;
    const ids = new Set(record.commentMessageIds || []);
    ids.add(Number(message.message_id));
    record.commentMessageIds = [...ids];
    record.commentCount = ids.size;
    await this.#save(record);
    return true;
  }

  async #handleReactionCount(change) {
    const record = (await this.list()).find(item => item.chatId === Number(change.chat?.id) && item.messageId === Number(change.message_id));
    if (!record) return false;
    record.reactions = structuredClone(change.reactions || []);
    record.reactionActors = {};
    record.reactionCount = record.reactions.reduce((sum, item) => sum + Number(item.total_count || 0), 0);
    await this.#save(record);
    return true;
  }

  async #handleReaction(change) {
    const record = (await this.list()).find(item => item.chatId === Number(change.chat?.id) && item.messageId === Number(change.message_id));
    if (!record) return false;
    const actor = change.user?.id ? `user:${change.user.id}` : change.actor_chat?.id ? `chat:${change.actor_chat.id}` : "unknown";
    record.reactionActors ||= {};
    const reactions = Array.isArray(change.new_reaction) ? structuredClone(change.new_reaction) : [];
    if (reactions.length) record.reactionActors[actor] = reactions;
    else delete record.reactionActors[actor];
    const totals = new Map();
    for (const actorReactions of Object.values(record.reactionActors)) {
      for (const type of actorReactions || []) {
        const key = reactionKey(type);
        const current = totals.get(key) || { type: structuredClone(type), total_count: 0 };
        current.total_count += 1;
        totals.set(key, current);
      }
    }
    record.reactions = [...totals.values()];
    record.reactionCount = record.reactions.reduce((sum, item) => sum + Number(item.total_count || 0), 0);
    await this.#save(record);
    return true;
  }

  async #save(record) {
    await this.db.put("publications", record.id, record);
    this.events?.emit("telegram:publications-changed", await this.list());
  }
}

function reactionKey(type) {
  if (type?.type === "emoji") return `emoji:${type.emoji || ""}`;
  if (type?.type === "custom_emoji") return `custom:${type.custom_emoji_id || ""}`;
  return String(type?.type || "unknown");
}

function astTree(ast) {
  const root = structuredClone(ast);
  return {
    root,
    walk(visitor, start = root, parent = null) {
      visitor(start, parent);
      for (const child of start.children || []) this.walk(visitor, child, start);
    }
  };
}

export function publicationDeleteHoursLeft(record, now = Date.now()) {
  return Math.max(0, Math.ceil((publicationDeleteUntil(record) - Number(now)) / 3600000));
}

export function isPublicationDeleteAvailable(record, now = Date.now()) {
  return publicationDeleteHoursLeft(record, now) > 0;
}

function publicationDeleteUntil(record) {
  const explicitDeadline = Number(record?.deleteUntil || 0);
  if (explicitDeadline > 0) return explicitDeadline;
  return Number(record?.publishedAt || 0) + PUBLICATION_DELETE_WINDOW_MS;
}
