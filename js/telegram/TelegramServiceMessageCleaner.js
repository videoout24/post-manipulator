// Bot API Message fields whose presence identifies a service message. Keep
// this explicit: treating every message without text as a service message
// would also delete photos, documents, voice messages and other user media.
const SERVICE_MESSAGE_FIELDS = Object.freeze([
  "new_chat_members",
  "left_chat_member",
  "chat_owner_left",
  "chat_owner_changed",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "message_auto_delete_timer_changed",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "successful_payment",
  "refunded_payment",
  "users_shared",
  "chat_shared",
  "gift",
  "unique_gift",
  "gift_upgrade_sent",
  "connected_website",
  "write_access_allowed",
  "proximity_alert_triggered",
  "boost_added",
  "chat_background_set",
  "checklist_tasks_done",
  "checklist_tasks_added",
  "community_chat_added",
  "community_chat_joined",
  "community_chat_removed",
  "direct_message_price_changed",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "giveaway_created",
  "giveaway_completed",
  "managed_bot_created",
  "paid_message_price_changed",
  "poll_option_added",
  "poll_option_deleted",
  "suggested_post_approved",
  "suggested_post_approval_failed",
  "suggested_post_declined",
  "suggested_post_paid",
  "suggested_post_refunded",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
  "web_app_data"
]);

/** Best-effort cleanup in system scopes and opted-in publication targets. */
export class TelegramServiceMessageCleaner {
  constructor({ client, ownerBinding, previewChannelBinding, publicationTargets = null, events = null } = {}) {
    Object.assign(this, { client, ownerBinding, previewChannelBinding, publicationTargets, events });
    this.stabilizedPrivateTopics = new Map();
    this.cleanedPrivateTopicServices = new Set();
    this.privateTopicStabilizations = new Map();
  }

  async handleUpdate(update) {
    const message = update?.message || update?.channel_post;
    if (!isTelegramServiceMessage(message)) return { handled: false, reason: "not_service" };
    if (message.chat?.type === "private" && Object.prototype.hasOwnProperty.call(message, "forum_topic_created")) {
      const owner = await this.ownerBinding?.getOwner?.();
      if (Number(owner?.chatId || 0) !== Number(message.chat.id)) {
        return { handled: false, reason: "outside_cleanup_scope" };
      }
      return this.stabilizePrivateTopic({
        chatId: message.chat.id,
        threadId: message.message_thread_id,
        serviceMessageId: message.message_id,
        createdAt: message.date
      });
    }

    const chatId = Number(message?.chat?.id || 0);
    const messageId = Number(message?.message_id || 0);
    if (!chatId || !messageId) return { handled: false, reason: "invalid_message" };

    try {
      const scope = await this.#scopeFor(message);
      if (!scope) return { handled: false, reason: "outside_cleanup_scope" };

      await this.client.deleteMessage(chatId, messageId);
      const result = { handled: true, deleted: true, scope, chatId, messageId };
      this.events?.emit?.("telegram:service-message-cleanup", result);
      return result;
    } catch (error) {
      // Telegram rejects old and intrinsically non-deletable service messages,
      // and a channel can lose its delete permission at any time. Cleanup must
      // never block the update offset or replay the same update forever.
      const result = {
        handled: true,
        deleted: false,
        chatId,
        messageId,
        error: { name: error?.name || "Error", code: Number(error?.errorCode || 0) }
      };
      this.events?.emit?.("telegram:service-message-cleanup", result);
      return result;
    }
  }

  async stabilizePrivateTopic({ chatId, threadId, serviceMessageId, createdAt = null } = {}) {
    const normalizedChatId = Number(chatId || 0);
    const normalizedThreadId = Number(threadId || 0);
    const normalizedServiceMessageId = Number(serviceMessageId || 0);
    if (!normalizedChatId || !normalizedThreadId) {
      return { handled: false, reason: "invalid_private_topic" };
    }
    // A private topic ID and its creation service-message ID aren't guaranteed
    // to be equal. Topic stabilization is therefore identified only by chat
    // and thread; the real message ID is accepted later from getUpdates.
    const key = `${normalizedChatId}:${normalizedThreadId}`;
    if (this.cleanedPrivateTopicServices.has(key)) {
      return { handled: true, stabilized: true, deleted: true, duplicate: true, chatId: normalizedChatId, threadId: normalizedThreadId };
    }
    const pending = this.privateTopicStabilizations.get(key);
    if (pending) {
      if (normalizedServiceMessageId) pending.serviceMessageId = normalizedServiceMessageId;
      return pending.promise;
    }

    const state = {
      key,
      chatId: normalizedChatId,
      threadId: normalizedThreadId,
      serviceMessageId: normalizedServiceMessageId,
      createdAt
    };
    state.promise = this.#stabilizePrivateTopicOnce(state);
    this.privateTopicStabilizations.set(key, state);
    try { return await state.promise; }
    finally { this.privateTopicStabilizations.delete(key); }
  }

  async #stabilizePrivateTopicOnce(state) {
    const { key, chatId, threadId, createdAt } = state;
    let markerMessageId = this.stabilizedPrivateTopics.get(key) ?? null;
    if (!this.stabilizedPrivateTopics.has(key)) {
      try {
        const marker = await this.client.sendMessage(
          chatId,
          privateTopicCreationMarker(createdAt),
          { messageThreadId: threadId }
        );
        markerMessageId = Number(marker?.message_id || 0) || null;
        this.stabilizedPrivateTopics.set(key, markerMessageId);
      } catch (error) {
        return this.#topicStabilizationFailure({
          chatId,
          threadId,
          serviceMessageId: Number(state.serviceMessageId || 0),
          stabilized: false,
          error
        });
      }
    }

    const serviceMessageId = Number(state.serviceMessageId || 0);
    if (!serviceMessageId) {
      return {
        handled: true,
        stabilized: true,
        deleted: false,
        reason: "awaiting_service_message",
        scope: "owner_private",
        chatId,
        threadId,
        messageId: null,
        markerMessageId: Number(markerMessageId) || null
      };
    }

    try {
      // Deleting an empty topic's creation message desynchronizes Telegram
      // clients. Only clean it after Telegram has accepted a regular message
      // into the new topic.
      await this.client.deleteMessage(chatId, serviceMessageId);
      this.cleanedPrivateTopicServices.add(key);
      const result = {
        handled: true,
        stabilized: true,
        deleted: true,
        scope: "owner_private",
        chatId,
        threadId,
        messageId: serviceMessageId,
        markerMessageId: Number(markerMessageId) || null
      };
      this.events?.emit?.("telegram:service-message-cleanup", result);
      return result;
    } catch (error) {
      return this.#topicStabilizationFailure({ chatId, threadId, serviceMessageId, markerMessageId, stabilized: true, error });
    }
  }

  #topicStabilizationFailure({ chatId, threadId, serviceMessageId, markerMessageId = null, stabilized, error }) {
    const result = {
      handled: true,
      stabilized,
      deleted: false,
      scope: "owner_private",
      chatId,
      threadId,
      messageId: serviceMessageId,
      markerMessageId: Number(markerMessageId) || null,
      error: { name: error?.name || "Error", code: Number(error?.errorCode || 0) }
    };
    this.events?.emit?.("telegram:service-message-cleanup", result);
    return result;
  }

  async #scopeFor(message) {
    const chatId = Number(message.chat?.id || 0);
    if (message.chat?.type === "private") {
      const owner = await this.ownerBinding?.getOwner?.();
      return Number(owner?.chatId || 0) === chatId ? "owner_private" : "";
    }
    if (message.chat?.type === "channel") {
      const preview = await this.previewChannelBinding?.getSlot?.();
      if (["bound", "unavailable"].includes(preview?.status)
        && Number(preview?.chatId || 0) === chatId) return "preview_channel";
    }

    if (!["channel", "group", "supergroup"].includes(message.chat?.type)) return "";
    const targets = await this.publicationTargets?.list?.() || [];
    const directTarget = targets.find(target => Number(target?.chatId || 0) === chatId);
    if (directTarget?.deleteServiceMessages === true) return "publication_target";
    const parentChannel = targets.find(target =>
      target?.type === "channel"
      && target.deleteServiceMessages === true
      && Number(target.linkedDiscussionChatId || 0) === chatId
    );
    if (parentChannel) return "publication_discussion";
    return "";
  }
}

export function privateTopicCreationMarker(createdAt = null) {
  const milliseconds = Number(createdAt || 0) > 0 ? Number(createdAt) * 1000 : Date.now();
  return new Date(milliseconds).toISOString();
}

export function isTelegramServiceMessage(message) {
  if (!message || typeof message !== "object") return false;
  return SERVICE_MESSAGE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(message, field));
}

export { SERVICE_MESSAGE_FIELDS };
