import assert from "node:assert/strict";
import {
  TelegramServiceMessageCleaner,
  isTelegramServiceMessage
} from "../js/telegram/TelegramServiceMessageCleaner.js?v=1.7.3";

const deleted = [];
const events = [];
let failDeletion = false;
const cleaner = new TelegramServiceMessageCleaner({
  client: {
    async deleteMessage(chatId, messageId) {
      if (failDeletion) throw Object.assign(new Error("forbidden"), { errorCode: 400 });
      deleted.push([chatId, messageId]);
    }
  },
  ownerBinding: { async getOwner() { return { chatId: 6185107635 }; } },
  previewChannelBinding: {
    async getSlot() { return { status: "bound", chatId: -1001234567890 }; }
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
assert.deepEqual(deleted, [[6185107635, 71], [-1001234567890, 81]]);

assert.equal((await cleaner.handleUpdate({
  message: { message_id: 91, chat: { id: 6185107635, type: "private" }, document: {} }
})).handled, false, "owner media must never be classified as service content");
assert.equal((await cleaner.handleUpdate({
  channel_post: { message_id: 92, chat: { id: -100999, type: "channel" }, pinned_message: {} }
})).handled, false, "service messages outside the preview channel must be preserved");

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
assert.equal(events.filter(([name]) => name === "telegram:service-message-cleanup").length, 3);

console.log("telegram_service_message_cleaner_smoke: OK");
