import assert from "node:assert/strict";
import {
  TelegramServiceMessageCleaner,
  isTelegramServiceMessage
} from "../js/telegram/TelegramServiceMessageCleaner.js?v=1.7.9";

const deleted = [];
const sent = [];
const events = [];
let failDeletion = false;
let failSending = false;
const publicationTargetRows = [
  {
    chatId: -100555,
    type: "channel",
    deleteServiceMessages: true,
    linkedDiscussionChatId: -200555
  },
  { chatId: -200777, type: "group", deleteServiceMessages: false }
];
const cleaner = new TelegramServiceMessageCleaner({
  client: {
    async sendMessage(chatId, text, options) {
      if (failSending) throw Object.assign(new Error("send failed"), { errorCode: 400 });
      sent.push([chatId, text, options]);
      return { message_id: 85 };
    },
    async deleteMessage(chatId, messageId) {
      if (failDeletion) throw Object.assign(new Error("forbidden"), { errorCode: 400 });
      deleted.push([chatId, messageId]);
    }
  },
  ownerBinding: { async getOwner() { return { chatId: 6185107635 }; } },
  previewChannelBinding: {
    async getSlot() { return { status: "bound", chatId: -1001234567890 }; }
  },
  publicationTargets: {
    async list() { return structuredClone(publicationTargetRows); }
  },
  events: { emit(name, value) { events.push([name, value]); } }
});

assert.equal(isTelegramServiceMessage({ pinned_message: {} }), true);
assert.equal(isTelegramServiceMessage({ forum_topic_edited: {} }), true);
assert.equal(isTelegramServiceMessage({ document: {}, caption: "backup" }), false);
assert.equal(isTelegramServiceMessage({ photo: [] }), false);

const ownerPin = await cleaner.handleUpdate({
  message: {
    message_id: 71,
    chat: { id: 6185107635, type: "private" },
    pinned_message: { message_id: 70 }
  }
});
assert.equal(ownerPin.deleted, true);
assert.equal(ownerPin.scope, "owner_private");

const previewService = await cleaner.handleUpdate({
  channel_post: {
    message_id: 81,
    chat: { id: -1001234567890, type: "channel" },
    chat_background_set: {}
  }
});
assert.equal(previewService.deleted, true);
assert.equal(previewService.scope, "preview_channel");

const targetService = await cleaner.handleUpdate({
  channel_post: {
    message_id: 82,
    chat: { id: -100555, type: "channel" },
    pinned_message: { message_id: 80 }
  }
});
assert.equal(targetService.deleted, true);
assert.equal(targetService.scope, "publication_target");

const discussionService = await cleaner.handleUpdate({
  message: {
    message_id: 83,
    chat: { id: -200555, type: "supergroup" },
    forum_topic_closed: {}
  }
});
assert.equal(discussionService.deleted, true);
assert.equal(discussionService.scope, "publication_discussion");
assert.deepEqual(deleted, [
  [6185107635, 71],
  [-1001234567890, 81],
  [-100555, 82],
  [-200555, 83]
]);

const deletedBeforeTopicCreation = deleted.length;
const directCreation = await cleaner.stabilizePrivateTopic({
  chatId: 6185107635,
  threadId: 9,
  createdAt: 1_800_000_000
});
assert.equal(directCreation.stabilized, true);
assert.equal(directCreation.deleted, false);
assert.equal(directCreation.reason, "awaiting_service_message");
for (const from of [{ id: 6185107635 }, { id: 123, is_bot: true }]) {
  const result = await cleaner.handleUpdate({
    message: {
      message_id: 84,
      chat: { id: 6185107635, type: "private" },
      from,
      date: 1_800_000_000,
      message_thread_id: 9,
      forum_topic_created: { name: "Media", icon_color: 7322096 }
    }
  });
  assert.equal(result.stabilized, true);
  assert.equal(result.deleted, false);
  assert.equal(result.retained, true);
  assert.equal(result.reason, "topic_creation_service_not_deletable");
}
assert.equal(sent.length, 1, "a replayed creation update must not add another marker");
assert.deepEqual(sent[0], [6185107635, "2027-01-15T08:00:00.000Z", { messageThreadId: 9 }]);
assert.deepEqual(deleted.slice(deletedBeforeTopicCreation), [], "topic-creation services must not be sent to deleteMessage");

const deletedBeforeFailedStabilization = deleted.length;
failSending = true;
const unstabilized = await cleaner.handleUpdate({
  message: {
    message_id: 86,
    chat: { id: 6185107635, type: "private" },
    date: 1_800_000_001,
    message_thread_id: 10,
    forum_topic_created: { name: "Unsafe to clean", icon_color: 7322096 }
  }
});
failSending = false;
assert.equal(unstabilized.stabilized, false);
assert.equal(unstabilized.deleted, false);
assert.equal(deleted.length, deletedBeforeFailedStabilization, "a creation marker must never be deleted when filling the topic failed");

const sentBeforeRetainedServiceReplay = sent.length;
const retainedTopicCreation = await cleaner.handleUpdate({
  message: {
    message_id: 87,
    chat: { id: 6185107635, type: "private" },
    date: 1_800_000_002,
    message_thread_id: 11,
    forum_topic_created: { name: "Retry cleanup", icon_color: 7322096 }
  }
});
assert.equal(retainedTopicCreation.stabilized, true);
assert.equal(retainedTopicCreation.deleted, false);
assert.equal(retainedTopicCreation.retained, true);
const retainedReplay = await cleaner.handleUpdate({
  message: {
    message_id: 87,
    chat: { id: 6185107635, type: "private" },
    date: 1_800_000_002,
    message_thread_id: 11,
    forum_topic_created: { name: "Retry cleanup", icon_color: 7322096 }
  }
});
assert.equal(retainedReplay.stabilized, true);
assert.equal(retainedReplay.deleted, false);
assert.equal(retainedReplay.retained, true);
assert.equal(retainedReplay.duplicate, true);
assert.equal(sent.length, sentBeforeRetainedServiceReplay + 1, "a replay must reuse the existing marker message");

assert.equal((await cleaner.handleUpdate({
  message: { message_id: 91, chat: { id: 6185107635, type: "private" }, document: {} }
})).handled, false, "owner media must never be classified as service content");
assert.equal((await cleaner.handleUpdate({
  channel_post: { message_id: 92, chat: { id: -100999, type: "channel" }, pinned_message: {} }
})).handled, false, "service messages outside the preview channel must be preserved");
assert.equal((await cleaner.handleUpdate({
  message: { message_id: 94, chat: { id: -200777, type: "supergroup" }, left_chat_member: {} }
})).handled, false, "an opted-out publication group must preserve its service messages");

publicationTargetRows[1].deleteServiceMessages = true;
const enabledGroup = await cleaner.handleUpdate({
  message: { message_id: 95, chat: { id: -200777, type: "supergroup" }, left_chat_member: {} }
});
assert.equal(enabledGroup.deleted, true);
assert.equal(enabledGroup.scope, "publication_target");

failDeletion = true;
const forbidden = await cleaner.handleUpdate({
  channel_post: {
    message_id: 93,
    chat: { id: -1001234567890, type: "channel" },
    channel_chat_created: true
  }
});
assert.equal(forbidden.handled, true);
assert.equal(forbidden.deleted, false, "Telegram deletion limits must not break update polling");
assert.equal(forbidden.error.code, 400);
assert.equal(events.filter(([name]) => name === "telegram:service-message-cleanup").length, 9);

console.log("telegram_service_message_cleaner_smoke: OK");
