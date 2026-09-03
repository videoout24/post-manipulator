import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { PreviewChannelBindingService } from "../js/telegram/PreviewChannelBindingService.js?v=1.5.9";

class MemoryDb {
  constructor() { this.values = new Map([["bindings:previewChannel", { status: "empty" }]]); }
  async get(store, key, fallback = null) { return structuredClone(this.values.get(`${store}:${key}`) ?? fallback); }
  async put(store, key, value) { this.values.set(`${store}:${key}`, structuredClone(value)); }
  async delete(store, key) { this.values.delete(`${store}:${key}`); }
}

function createService({ memberCount = 2, ownerStatus = "creator", botStatus = "administrator", automaticRetryDelays = [] } = {}) {
  const db = new MemoryDb();
  const calls = [];
  const events = new EventBus();
  const memberCounts = Array.isArray(memberCount) ? [...memberCount] : null;
  let lastMemberCount = memberCounts?.[0] ?? memberCount;
  let memberCountCalls = 0;
  let botMemberCalls = 0;
  const client = {
    async getMe() { return { id: 7 }; },
    async getChat(chatId) { return { id: Number(chatId), type: "channel", title: "Private preview" }; },
    async getChatMember(_chatId, userId) {
      if (Number(userId) === 7) {
        botMemberCalls += 1;
        return { status: botStatus, can_post_messages: true, can_edit_messages: true, can_delete_messages: true };
      }
      if (Number(userId) === 11) return { status: ownerStatus };
      return { status: "left" };
    },
    async getChatMemberCount() {
      memberCountCalls += 1;
      lastMemberCount = memberCounts?.shift() ?? lastMemberCount;
      return lastMemberCount;
    },
    async sendRichMessage(options) { calls.push(["send", options]); return { message_id: 55 }; },
    async pinChatMessage(chatId, messageId, options) { calls.push(["pin", chatId, messageId, options]); }
  };
  const service = new PreviewChannelBindingService({
    db,
    events,
    client,
    ownerBinding: { async getOwner() { return { userId: 11 }; } },
    automaticRetryDelays
  });
  return {
    service,
    db,
    calls,
    events,
    memberCountCalls: () => memberCountCalls,
    botMemberCalls: () => botMemberCalls
  };
}

const addedAsAdmin = {
  my_chat_member: {
    chat: { id: -1001234567890, type: "channel", title: "Private preview" },
    new_chat_member: { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true }
  }
};

const automatic = createService();
const livePreviewSettings = [];
automatic.events.on("telegram:live-preview-setting", setting => livePreviewSettings.push(setting));
assert.equal(await automatic.service.handleMyChatMember(addedAsAdmin), true);
const bound = await automatic.service.getSlot();
assert.equal(bound.status, "bound");
assert.equal(bound.source, "private_owner_pair");
assert.equal(bound.memberCount, 2);
assert.deepEqual(automatic.calls.map(call => call[0]), ["send", "pin"]);
assert.equal((await automatic.db.get("preview", "liveMessage")).messageId, 55);
assert.equal(await automatic.db.get("settings", "livePreviewEnabled"), true);
assert.deepEqual(livePreviewSettings, [{ enabled: true }]);

const delayedMembership = createService({
  memberCount: [1, 2],
  botStatus: "left",
  automaticRetryDelays: [0]
});
assert.equal(await delayedMembership.service.handleMyChatMember(addedAsAdmin), true);
assert.equal((await delayedMembership.service.getSlot()).status, "bound");
assert.equal(delayedMembership.memberCountCalls(), 2, "initially stale channel membership must be rechecked");
assert.equal(delayedMembership.botMemberCalls(), 0, "rights from my_chat_member must be used without a stale API reread");
assert.deepEqual(delayedMembership.calls.map(call => call[0]), ["send", "pin"]);

const thirdMember = createService({ memberCount: 3 });
assert.equal(await thirdMember.service.handleMyChatMember(addedAsAdmin), false);
assert.equal((await thirdMember.service.getSlot()).status, "empty");
assert.equal(thirdMember.calls.length, 0, "a channel with a third member must never be auto-bound");

const ownerAbsent = createService({ ownerStatus: "left" });
assert.equal(await ownerAbsent.service.handleMyChatMember(addedAsAdmin), false);
assert.equal((await ownerAbsent.service.getSlot()).status, "empty");

console.log("preview_channel_auto_binding_smoke: OK");
