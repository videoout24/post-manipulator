import { t } from "../i18n/index.js?v=1.8.0";
import { randomUUID } from "../core/Random.js?v=1.5.9";
import { materializeRelationUrl, relationIdsInAst, removeLinkRelationFromAst } from "../links/LinkRelationAst.js?v=1.5.9";

export const PUBLICATION_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const PENDING_FORWARD_PREFIX = "publicationForward:";
const MAX_TIMER_DELAY = 2_147_000_000;
const SCHEDULE_RETRY_DELAY = 60_000;

export class PublicationService {
  constructor({ db, events = null, client, renderer, validator, targets, drafts, draftSession = null, documents = null, linkRelations = null } = {}) {
    Object.assign(this, { db, events, client, renderer, validator, targets, drafts, draftSession, documents, linkRelations });
    this.scheduleTimers = new Map();
    this.recordOperations = new Map();
    this.linkUnsubscribe = this.events?.on?.("links:changed", event => {
      if (event?.reason !== "removed" || event?.relation?.source?.kind !== "publication") return;
      this.#removeRelationFromPublishedSource(event.relation).catch(error => {
        this.events?.emit?.("ui:toast", { message: t("telegram.publicationService.failedToUpdateUnlinkedPublication", { 0: error?.message || error }), type: "error" });
      });
    });
    this.projectPublicationUnsubscribe = this.events?.on?.("telegram:project-publication-record", record => {
      this.#reconcilePendingForward(record).catch(error => {
        this.events?.emit?.("telegram:publication-discussion-error", { record, error });
      });
    });
  }

  async initialize() {
    for (const record of await this.list()) {
      if (record?.source?.kind === "draft" && record.scheduledAt && !record.messageId) this.#armSchedule(record);
    }
  }

  stop() {
    for (const entry of this.scheduleTimers.values()) clearTimeout(entry.timer);
    this.scheduleTimers.clear();
    this.recordOperations.clear();
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

  async scheduleDraft(draftId, targetChatId, { scheduledAt, commentsEnabled = true } = {}) {
    const publishAt = Number(scheduledAt || 0);
    if (!Number.isFinite(publishAt) || publishAt <= Date.now()) {
      throw new Error(t("project.projectPublicationService.specifyAFutureScheduledPublicationTime"));
    }
    const [draft, target] = await Promise.all([
      this.drafts.get(draftId),
      this.#requireTarget(targetChatId)
    ]);
    if (!draft) throw new Error(t("editor.editorRightPanel.draftNotFound"));
    if (draft.source?.kind === "publication") throw new Error(t("telegram.publicationService.workingCopyOfThePublicationCannotBe"));
    if (!draft.messageAst?.children?.length) throw new Error(t("telegram.publicationService.emptyDraftCannotBeScheduled"));
    this.#assertCommentsConfig(target, commentsEnabled);
    const errors = this.validator.validate(astTree(draft.messageAst));
    if (errors.length) throw new Error(errors.join("; "));

    const record = {
      id: `publication_${randomUUID()}`,
      source: {
        kind: "draft",
        draftId: draft.id,
        title: draft.title,
        draftSource: draft.source ? structuredClone(draft.source) : null,
        draftCreatedAt: Number(draft.createdAt || Date.now()),
        draftUpdatedAt: Number(draft.updatedAt || draft.createdAt || Date.now())
      },
      messageAst: structuredClone(draft.messageAst),
      target: structuredClone(target),
      chatId: Number(target.chatId),
      messageId: null,
      publishedAt: null,
      scheduledAt: publishAt,
      createdAt: Date.now(),
      deleteUntil: null,
      commentsRequested: Boolean(commentsEnabled),
      commentsEnabled: target.type === "channel" && Boolean(target.commentsEnabled) && Boolean(commentsEnabled),
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
    if (this.documents?.clearScheduledDraft) await this.documents.clearScheduledDraft(draft.id);
    else if (this.documents?.clearPublishedDraft) await this.documents.clearPublishedDraft(draft.id);
    else if (this.draftSession?.activeDraftId === draft.id) {
      await this.draftSession.deactivate({ flush: false, reason: "scheduled" });
    }
    await this.drafts.delete(draft.id);
    this.#armSchedule(record);
    this.events?.emit("telegram:draft-publication-scheduled", structuredClone(record));
    this.events?.emit("telegram:publications-changed", await this.list());
    return structuredClone(record);
  }

  async cancelDraftSchedule(recordId) {
    return this.#withRecordOperation(recordId, async () => {
      const record = await this.db.get("publications", recordId, null);
      if (!record?.scheduledAt || record.source?.kind !== "draft" || record.messageId) {
        throw new Error(t("telegram.publicationService.thisDraftIsNotInTheScheduled"));
      }
      const editDrafts = (await this.drafts.list()).filter(draft =>
        draft.source?.kind === "publication" && String(draft.source.publicationId) === String(record.id)
      );
      if (editDrafts.some(draft => String(draft.id) === String(this.draftSession?.activeDraftId || ""))) {
        throw new Error(t("telegram.publicationService.firstApplyOrCancelTheEditingOf"));
      }
      this.#clearSchedule(record.id);
      await this.linkRelations?.reconcileSource?.({ kind: "publication", id: record.id }, record.messageAst);
      for (const draft of editDrafts) await this.drafts.delete(draft.id);
      const restored = await this.drafts.restore({
        id: record.source.draftId,
        title: record.source.title || t("editor.draftListView.draft"),
        messageAst: record.messageAst,
        source: record.source.draftSource || null,
        createdAt: record.source.draftCreatedAt,
        updatedAt: Date.now()
      });
      await this.linkRelations?.bindSourcePublicationToDraft?.(record.id, restored.id);
      await this.linkRelations?.bindTargetPublicationToDraft?.(record.id, restored.id);
      await this.db.delete("publications", record.id);
      this.events?.emit("telegram:draft-publication-schedule-cancelled", { record: structuredClone(record), draft: structuredClone(restored) });
      this.events?.emit("telegram:publications-changed", await this.list());
      return restored;
    });
  }

  async publishDraft(draftId, targetChatId, { commentsEnabled = true } = {}) {
    const [draft, target] = await Promise.all([
      this.drafts.get(draftId),
      this.targets.list().then(rows => rows.find(item => Number(item.chatId) === Number(targetChatId)))
    ]);
    if (!draft) throw new Error(t("editor.editorRightPanel.draftNotFound"));
    if (!draft.messageAst?.children?.length) throw new Error(t("telegram.publicationService.emptyDraftCannotBePublished"));
    if (!target || target.status !== "ready") throw new Error(t("project.projectPublicationService.channelOrGroupNotAvailableForPublishing"));
    if (target.type === "channel" && target.commentsEnabled && commentsEnabled === false && !target.discussionRights?.canDelete) {
      throw new Error(t("project.projectPublicationService.toDisableCommentsTheBotNeedsThe"));
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
    const messageId = Number(message?.message_id || 0);
    if (!messageId) throw new Error(t("telegram.publicationService.telegramDidNotReturnMessageIdFor"));
    const publishedAt = Number(message.date || Math.floor(Date.now() / 1000)) * 1000;
    const record = {
      id: `publication_${randomUUID()}`,
      source: { kind: "draft", draftId: draft.id, title: draft.title },
      messageAst: structuredClone(publishAst),
      target: structuredClone(target),
      chatId: Number(target.chatId),
      messageId,
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

  #armSchedule(record, { runAt = Number(record?.scheduledAt || 0) } = {}) {
    const scheduledAt = Number(record?.scheduledAt || 0);
    if (!record?.id || !scheduledAt || record.messageId) return;
    const current = this.scheduleTimers.get(record.id);
    if (current?.scheduledAt === scheduledAt) return;
    this.#clearSchedule(record.id);
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY, Number(runAt || scheduledAt) - Date.now()));
    const timer = setTimeout(() => {
      this.scheduleTimers.delete(record.id);
      if (scheduledAt > Date.now()) {
        this.#armSchedule(record);
        return;
      }
      this.#runScheduledDraft(record.id, scheduledAt).catch(() => {});
    }, delay);
    this.scheduleTimers.set(record.id, { timer, scheduledAt, runAt: Number(runAt || scheduledAt) });
  }

  #clearSchedule(recordId) {
    const entry = this.scheduleTimers.get(recordId);
    if (entry) clearTimeout(entry.timer);
    this.scheduleTimers.delete(recordId);
  }

  async #runScheduledDraft(recordId, expectedScheduledAt) {
    try {
      return await this.#withRecordOperation(recordId, async () => {
        const record = await this.db.get("publications", recordId, null);
        if (!record?.scheduledAt || record.messageId || record.source?.kind !== "draft") return null;
        if (Number(record.scheduledAt) !== Number(expectedScheduledAt)) return null;
        if (Number(record.scheduledAt) > Date.now()) {
          this.#armSchedule(record);
          return null;
        }
        return this.#publishScheduledDraft(record);
      });
    } catch (error) {
      const record = await this.db.get("publications", recordId, null).catch(() => null);
      if (record?.scheduledAt && !record.messageId && Number(record.scheduledAt) === Number(expectedScheduledAt)) {
        this.events?.emit("telegram:draft-publication-schedule-error", {
          record: structuredClone(record),
          error,
          message: error?.message || String(error)
        });
        this.#armSchedule(record, { runAt: Date.now() + SCHEDULE_RETRY_DELAY });
      }
      throw error;
    }
  }

  async #publishScheduledDraft(record) {
    const target = await this.#requireTarget(record.chatId);
    const commentsRequested = record.commentsRequested !== false;
    this.#assertCommentsConfig(target, commentsRequested);
    const publishAst = await this.linkRelations?.materializeAst?.(record.messageAst) || record.messageAst;
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
    const messageId = Number(message?.message_id || 0);
    if (!messageId) throw new Error(t("telegram.publicationService.telegramDidNotReturnMessageIdFor2"));
    const publishedAt = Number(message.date || Math.floor(Date.now() / 1000)) * 1000;
    record.messageAst = structuredClone(publishAst);
    record.target = structuredClone(target);
    record.chatId = Number(target.chatId);
    record.messageId = messageId;
    record.publishedAt = publishedAt;
    record.scheduledAt = null;
    record.deleteUntil = publishedAt + PUBLICATION_DELETE_WINDOW_MS;
    record.commentsEnabled = target.type === "channel" && Boolean(target.commentsEnabled) && commentsRequested;
    record.discussionChatId = target.linkedDiscussionChatId || null;
    record.discussionUsername = target.linkedDiscussionUsername || "";
    await this.db.put("publications", record.id, record);
    const resolvedRelations = await this.linkRelations?.resolveWaitingForPublication?.(record) || [];
    await this.#applyResolvedRelations(resolvedRelations);
    this.events?.emit("telegram:publication-created", structuredClone(record));
    this.events?.emit("telegram:publications-changed", await this.list());
    this.#reconcilePendingForward(record).catch(error => {
      this.events?.emit("telegram:publication-discussion-error", { record, error });
    });
    return structuredClone(record);
  }

  async #requireTarget(chatId) {
    const target = (await this.targets.list()).find(item => Number(item.chatId) === Number(chatId));
    if (!target || target.status !== "ready") throw new Error(t("project.projectPublicationService.channelOrGroupNotAvailableForPublishing"));
    return target;
  }

  #assertCommentsConfig(target, commentsEnabled) {
    if (target.type === "channel" && target.commentsEnabled && commentsEnabled === false && !target.discussionRights?.canDelete) {
      throw new Error(t("project.projectPublicationService.toDisableCommentsTheBotNeedsThe"));
    }
  }

  #withRecordOperation(recordId, operation) {
    const key = String(recordId || "");
    const previous = this.recordOperations.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.recordOperations.set(key, current);
    return current.finally(() => {
      if (this.recordOperations.get(key) === current) this.recordOperations.delete(key);
    });
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
    if (!record) throw new Error(t("telegram.publicationService.publicationNotFound"));
    if (record.scheduledAt || !record.chatId || !record.messageId) {
      throw new Error(t("telegram.publicationService.onlyPublishedPostsCanBePinned"));
    }
    const nextPinned = Boolean(pinned);
    if (nextPinned === Boolean(record.pinned)) return structuredClone(record);
    if (nextPinned && record.commentsEnabled && (!record.discussionChatId || !record.discussionMessageId)) {
      throw new Error(t("telegram.publicationService.waitForTheMessageToAppearIn"));
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
      throw new Error(t("telegram.publicationService.failedToSynchronizePinningOfThePost", { 0: error?.message || error }));
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
      throw new Error(t("project.projectPublicationService.the48HourPeriodForDeletingA"));
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
    if (!record) throw new Error(t("telegram.publicationService.publicationNotFound"));
    if (isPublicationDeleteAvailable(record)) throw new Error(t("telegram.publicationService.regularDeletionIsStillAvailableForThis"));
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
    if (!record) throw new Error(t("telegram.publicationService.publicationNotFound"));
    if (!record.messageAst?.children) throw new Error(t("telegram.publicationService.thereIsNoLocalCopyOfThe"));
    const existing = (await this.drafts.list()).find(draft =>
      draft.source?.kind === "publication" && draft.source?.publicationId === record.id
    );
    if (existing) return existing;
    return this.drafts.create({
      title: t("telegram.publicationService.edit", { 0: record.source?.title || t("editor.draftListView.publication") }),
      messageAst: record.messageAst,
      source: {
        kind: "publication",
        publicationId: record.id,
        chatId: record.chatId,
        messageId: record.messageId,
        targetTitle: record.target?.title || "",
        scheduledAt: Number(record.scheduledAt || 0) || null
      }
    });
  }

  async applyDraftChanges(draftId) {
    const draft = await this.drafts.get(draftId);
    const publicationId = draft?.source?.kind === "publication" ? draft.source.publicationId : null;
    if (!draft || !publicationId) throw new Error(t("telegram.publicationService.draftIsNotLinkedToAPublication"));
    return this.#withRecordOperation(publicationId, async () => {
      const record = await this.db.get("publications", publicationId, null);
      if (!record) throw new Error(t("telegram.publicationService.originalPublicationNotFound"));
      const appliedAst = await this.linkRelations?.materializeAst?.(draft.messageAst) || draft.messageAst;
      const tree = astTree(appliedAst);
      const errors = this.validator.validate(tree);
      if (errors.length) throw new Error(errors.join("; "));
      if (!record.scheduledAt) {
        const envelope = this.renderer.renderEnvelope(tree);
        await this.client.editRichMessage({
          chatId: record.chatId,
          messageId: record.messageId,
          richMessage: envelope.richMessage,
          replyMarkup: envelope.replyMarkup
        });
      }
      record.messageAst = structuredClone(appliedAst);
      record.editedAt = Date.now();
      await this.db.put("publications", record.id, record);
      this.events?.emit("telegram:publication-updated", structuredClone(record));
      this.events?.emit("telegram:publications-changed", await this.list());
      return structuredClone(record);
    });
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
