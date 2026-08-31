import assert from "node:assert/strict";
import { PublicationTargetService, publicationAvailability } from "../js/telegram/PublicationTargetService.js?v=1.5.9";

class MemoryDb {
  constructor() { this.data = new Map(); }
  key(store, key) { return `${store}:${key}`; }
  async get(store, key, fallback = null) { return structuredClone(this.data.get(this.key(store, key)) ?? fallback); }
  async put(store, key, value) { this.data.set(this.key(store, key), structuredClone(value)); return value; }
  async delete(store, key) { this.data.delete(this.key(store, key)); }
}

const db = new MemoryDb();
const chats = new Map([
  [-1001, { id: -1001, type: "channel", title: "News", linked_chat_id: -2001 }],
  [-2001, { id: -2001, type: "supergroup", title: "News comments", username: "news_comments", linked_chat_id: -1001 }],
  [-2002, { id: -2002, type: "supergroup", title: "Community" }]
]);
const client = {
  async getMe() { return { id: 7 }; },
  async getChat(id) { return chats.get(Number(id)); },
  async getChatMember(id) {
    return Number(id) === -1001
      ? { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true }
      : Number(id) === -2001
        ? { status: "administrator", can_delete_messages: true }
      : { status: "administrator", can_delete_messages: true, can_pin_messages: true };
  },
  async getChatMemberCount(id) { return Number(id) === -1001 ? 1200 : 85; },
  async deleteMessage() { return true; }
};
const previewChannelBinding = {
  async getSlot() { return { status: "bound", chatId: -999 }; },
  async getSession() { return null; }
};
const service = new PublicationTargetService({ db, client, previewChannelBinding });

await db.put("bindings", "publicationTargets", [{
  chatId: -2001, type: "group", title: "News comments", status: "ready"
}]);

await service.handleMyChatMember({ my_chat_member: {
  chat: chats.get(-1001),
  new_chat_member: { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true }
} });
let targets = await service.list();
assert.equal(targets.length, 1);
assert.equal(targets[0].commentsEnabled, true);
assert.equal(targets[0].memberCount, 1200);
assert.equal(targets[0].discussionRights.canDelete, true);
assert.equal(targets[0].linkedDiscussionTitle, "News comments");
assert.equal(targets[0].visibility, "private");
assert.equal(targets.some(item => item.chatId === -2001), false);

await service.handleMyChatMember({ my_chat_member: {
  chat: chats.get(-2001),
  new_chat_member: { status: "administrator", can_delete_messages: true }
} });
assert.equal((await service.list()).some(item => item.chatId === -2001), false);

const session = await service.startBinding();
await service.handleMessage({ message: { message_id: 10, text: session.code, chat: chats.get(-2002) } });
targets = await service.list();
assert.equal(targets.length, 2);
assert.equal(targets[1].type, "group");
assert.equal(targets[1].status, "ready");

await service.handleMyChatMember({ my_chat_member: {
  chat: chats.get(-2002), new_chat_member: { status: "member" }
} });
assert.equal((await service.list()).find(item => item.chatId === -2002).status, "unavailable");

await service.handleMyChatMember({ my_chat_member: {
  chat: { id: -999, type: "channel", title: "Preview" },
  new_chat_member: { status: "administrator", can_post_messages: true }
} });
assert.equal((await service.list()).some(item => item.chatId === -999), false);
assert.equal(publicationAvailability({ status: "member" }, "group").ready, false);

console.log("publication targets smoke: OK");
