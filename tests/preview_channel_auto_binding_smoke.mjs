import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { PreviewChannelBindingService } from "../js/telegram/PreviewChannelBindingService.js?v=1.5.9";

class MemoryDb {
  constructor() { this.values = new Map([["bindings:previewChannel", { status: "empty" }]]); }
  async get(store, key, fallback = null) { return structuredClone(this.values.get(`${store}:${key}`) ?? fallback); }
  async put(store, key, value) { this.values.set(`${store}:${key}`, structuredClone(value)); }
  async delete(store, key) { this.values.delete(`${store}:${key}`); }
}

function createService({ memberCount = 2, ownerStatus = "creator" } = {}) {
  const db = new MemoryDb();
  const calls = [];
  const client = {
    async getMe() { return { id: 7 }; },
    async getChat(chatId) { return { id: Number(chatId), type: "channel", title: "Private preview" }; },
    async getChatMember(_chatId, userId) {
      if (Number(userId) === 7) {
        return { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true };
      }
      if (Number(userId) === 11) return { status: ownerStatus };
      return { status: "left" };
    },
    async getChatMemberCount() { return memberCount; },
    async sendRichMessage(options) { calls.push(["send", options]); return { message_id: 55 }; },
    async pinChatMessage(chatId, messageId, options) { calls.push(["pin", chatId, messageId, options]); }
  };
  const service = new PreviewChannelBindingService({
    db,
    events: new EventBus(),
    client,
    ownerBinding: { async getOwner() { return { userId: 11 }; } }
  });
  return { service, db, calls };
}

const addedAsAdmin = {
  my_chat_member: {
    chat: { id: -1001234567890, type: "channel", title: "Private preview" },
    new_chat_member: { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true }
  }
};

const automatic = createService();
assert.equal(await automatic.service.handleMyChatMember(addedAsAdmin), true);
const bound = await automatic.service.getSlot();
assert.equal(bound.status, "bound");
assert.equal(bound.source, "private_owner_pair");
assert.equal(bound.memberCount, 2);
assert.deepEqual(automatic.calls.map(call => call[0]), ["send", "pin"]);
assert.equal((await automatic.db.get("preview", "liveMessage")).messageId, 55);

const thirdMember = createService({ memberCount: 3 });
assert.equal(await thirdMember.service.handleMyChatMember(addedAsAdmin), false);
assert.equal((await thirdMember.service.getSlot()).status, "empty");
assert.equal(thirdMember.calls.length, 0, "a channel with a third member must never be auto-bound");

const ownerAbsent = createService({ ownerStatus: "left" });
assert.equal(await ownerAbsent.service.handleMyChatMember(addedAsAdmin), false);
assert.equal((await ownerAbsent.service.getSlot()).status, "empty");

console.log("preview_channel_auto_binding_smoke: OK");
