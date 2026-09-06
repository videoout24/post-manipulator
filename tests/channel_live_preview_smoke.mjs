import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { PreviewController } from "../js/telegram/PreviewController.js?v=1.5.9";
import { TelegramApiError } from "../js/telegram/TelegramClient.js?v=1.5.9";

const values = new Map([
  ["settings:livePreviewEnabled", true],
  ["bindings:previewChannel", { status: "empty" }]
]);
const db = {
  async get(store, key, fallback = null) { return values.get(`${store}:${key}`) ?? fallback; },
  async put(store, key, value) { values.set(`${store}:${key}`, value); }
};
const events = new EventBus();
const statuses = [];
events.on("telegram:preview-status", status => statuses.push(status));
const calls = [];
let pinnedMessageId = null;
let nextMessageId = 42;
const client = {
  hasToken: () => true,
  async getChat() {
    return { pinned_message: pinnedMessageId ? { message_id: pinnedMessageId } : undefined };
  },
  async sendRichMessage(options) {
    calls.push(options);
    return { message_id: nextMessageId++ };
  },
  async pinChatMessage(chatId, messageId) {
    pinnedMessageId = Number(messageId);
    calls.push({ pin: true, chatId, messageId });
  },
  async deleteMessage() {}
};
const previewChannelBinding = {
  getSlot: () => db.get("bindings", "previewChannel", { status: "empty" }),
  async markUnavailable() {}
};
const controller = new PreviewController({
  db,
  events,
  client,
  previewChannelBinding,
  renderer: { renderEnvelope: () => ({ richMessage: { text: "Preview" } }) },
  validator: { validate: () => [] },
  tree: { root: {} }
});

assert.equal(await controller.isEnabled(), false);
assert.equal((await controller.sync({ force: true })).skipped, "channel_not_bound");
assert.equal(statuses.at(-1).state, "unavailable");

await db.put("bindings", "previewChannel", { status: "bound", chatId: -1001234567890, title: "Preview" });
assert.equal(await controller.isEnabled(), true);
const result = await controller.sync();
assert.equal(result.chatId, -1001234567890);
assert.equal(result.messageId, 42);
assert.equal(calls.length, 2);
assert.equal(calls[0].chatId, -1001234567890);
assert.equal("messageThreadId" in calls[0], false);
assert.deepEqual(calls[1], { pin: true, chatId: -1001234567890, messageId: 42 });
assert.equal(result.pinned, true);
assert.deepEqual(await controller.getMessage(), result);

pinnedMessageId = null;
client.editRichMessage = async () => {
  throw new TelegramApiError("message is not modified", {
    method: "editMessageText",
    errorCode: 400,
    description: "Bad Request: message is not modified"
  });
};
const repinned = await controller.sync();
assert.equal(repinned.mode, "repinned");
assert.equal(repinned.messageId, result.messageId);
assert.equal(pinnedMessageId, result.messageId);

pinnedMessageId = null;
client.editRichMessage = async () => {
  throw new TelegramApiError("message to edit not found", {
    method: "editMessageText",
    errorCode: 400,
    description: "Bad Request: message to edit not found"
  });
};
const recovered = await controller.sync();
assert.equal(recovered.mode, "recreated");
assert.equal(recovered.pinned, true);
assert.notEqual(recovered.messageId, result.messageId);
assert.equal(calls.filter(call => call.pin).length, 3);
assert.equal((await controller.getMessage()).messageId, recovered.messageId);

console.log("channel_live_preview_smoke: OK");
