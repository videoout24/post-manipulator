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
  }

  async handleUpdate(update) {
    const message = update?.message || update?.channel_post;
    if (!isTelegramServiceMessage(message)) return { handled: false, reason: "not_service" };

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

export function isTelegramServiceMessage(message) {
  if (!message || typeof message !== "object") return false;
  return SERVICE_MESSAGE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(message, field));
}

export { SERVICE_MESSAGE_FIELDS };
