import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { PreviewChannelBindingService } from "../js/telegram/PreviewChannelBindingService.js?v=1.5.9";

const values = new Map([
  ["bindings:previewChannel", { status: "empty" }],
  ["runtime:previewChannelBinding", {
    status: "waiting_confirmation",
    code: "PREVIEW-CODE",
    candidate: { chatId: -1001234567890, title: "Preview" },
    expiresAt: Date.now() + 60_000
  }]
]);
const db = {
  async get(store, key, fallback = null) { return values.get(`${store}:${key}`) ?? fallback; },
  async put(store, key, value) { values.set(`${store}:${key}`, value); },
  async delete(store, key) { values.delete(`${store}:${key}`); }
};
const calls = [];
const client = {
  async getMe() { return { id: 7 }; },
  async getChatMember() {
    return { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true };
  },
  async deleteMessage(chatId, messageId) { calls.push(["delete", chatId, messageId]); },
  async sendRichMessage(options) {
    calls.push(["send", options]);
    return { message_id: 55 };
  },
  async pinChatMessage(chatId, messageId, options) { calls.push(["pin", chatId, messageId, options]); }
};
const events = new EventBus();
const service = new PreviewChannelBindingService({
  db,
  events,
  client,
  ownerBinding: { async getOwner() { return { userId: 1 }; } }
});

const handled = await service.handleChannelPost({
  channel_post: {
    message_id: 9,
    text: "PREVIEW-CODE",
    chat: { id: -1001234567890, type: "channel", title: "Preview" }
  }
});

assert.equal(handled, true);
assert.equal((await service.getSlot()).status, "bound");
assert.deepEqual(calls.map(call => call[0]), ["delete", "send", "pin"]);
assert.equal(calls[1][1].chatId, -1001234567890);
assert.deepEqual(calls[1][1].richMessage, {
  blocks: [{ type: "paragraph", text: "Предпросмотр текущего сообщения появится здесь после включения синхронизации." }]
});
assert.equal(calls[2][2], 55);
assert.deepEqual(await db.get("preview", "liveMessage"), {
  chatId: -1001234567890,
  messageId: 55,
  hash: "",
  mode: "provisioned",
  pinned: true,
  syncedAt: (await db.get("preview", "liveMessage")).syncedAt
});

console.log("preview_channel_provisioning_smoke: OK");
