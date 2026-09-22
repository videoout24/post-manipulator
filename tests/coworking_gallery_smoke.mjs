import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { GalleryStore } from "../js/gallery/GalleryStore.js";
import { GalleryCore } from "../js/gallery/GalleryCore.js";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  s(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { return structuredClone(this.s(store).get(key) ?? fallback); }
  async put(store, key, value) { this.s(store).set(key, structuredClone(value)); return value; }
  async delete(store, key) { this.s(store).delete(key); }
  async all(store) { return [...this.s(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
  async indexAll(store, index, value) {
    const rows = await this.all(store);
    if (index === "bySourceEventKey") return rows.filter(row => row.value.sourceEventKey === value);
    if (index === "byFileUniqueId") return rows.filter(row => row.value.telegram?.fileUniqueId === value);
    if (index === "byThreadId") return rows.filter(row => Number(row.value.topicThreadId) === Number(value));
    if (index === "byType") return rows.filter(row => row.value.type === value);
    return [];
  }
}

const db = new MemoryDb();
const events = new EventBus();
const store = new GalleryStore({ db, events });
const copied = [];
const sent = [];
const deleted = [];
let nextMessageId = 900;
const client = {
  async copyMessage(payload) { copied.push(payload); return { message_id: nextMessageId++ }; },
  async sendStoredMedia(payload) { sent.push(payload); return { message_id: nextMessageId++ }; },
  async deleteMessage(chatId, messageId) { deleted.push([chatId, messageId]); }
};
let nextThreadId = 70;
const telegramCore = {
  owner: { async getOwner() { return { chatId: 100, userId: 1 }; } },
  media: { onReceived: handler => events.on("telegram:owner-media", handler), onCollaborationReceived: handler => events.on("telegram:collaboration-media", handler) },
  topics: {
    onObserved: handler => events.on("telegram:owner-topic-event", handler),
    async create(name) { return { chatId: 100, threadId: nextThreadId++, name }; }
  }
};
const gallery = new GalleryCore({
  db,
  events,
  telegramCore,
  client,
  store,
  thumbnails: { async remove() {} }
});

const bot = { id: 20, username: "cowork_bot", firstName: "Cowork" };
const ordinary = {
  type: "document", fileId: "document-file", fileUniqueId: "document-unique", fileName: "brief.pdf",
  sourceEventKey: "-100:10", separate: false, bot,
  source: { chatId: -100, messageId: 10, threadId: null }
};
const asset = await gallery.ingestCollaborationMedia(ordinary);
assert.equal(copied.length, 1, "ordinary bot media is copied intact into the private owner topic");
assert.equal(sent.length, 0);
assert.equal(asset.source.chatId, 100);
assert.equal(asset.topicThreadId, 70);
assert.deepEqual(asset.originSource, ordinary.source);
assert.equal((await store.listTopics())[0].systemRole, "collaboration-bot:20");
assert.equal(await gallery.ingestCollaborationMedia(ordinary).then(value => value.id), asset.id);
assert.equal(copied.length, 1, "replayed updates do not create another Telegram copy");

const richMedia = {
  type: "photo", fileId: "photo-file", fileUniqueId: "photo-unique", caption: "Inside Rich Message",
  sourceEventKey: "-100:#comessage_test:rich:2", separate: true, bot,
  source: { chatId: -100, messageId: 11, threadId: null }
};
const photoAsset = await gallery.ingestCollaborationMedia(richMedia);
assert.equal(sent.length, 1, "each Rich Message media block is stored as its own Telegram file message");
assert.equal(sent[0].messageThreadId, 70, "the same bot reuses its private topic");
assert.equal(photoAsset.topicThreadId, 70);

await gallery.setSettings({ deleteSourceAfterIndexing: true });
const direct = await gallery.ingestCollaborationMedia({
  ...ordinary,
  fileId: "audio-file",
  fileUniqueId: "audio-unique",
  type: "audio",
  sourceEventKey: "-100:12",
  source: { chatId: -100, messageId: 12, threadId: null }
});
assert.equal(direct.source.chatId, -100, "delete-after-index mode indexes the channel source without making a retained topic copy");
assert.equal(copied.length, 1);
assert.equal(deleted.length, 0, "shared channel posts are never deleted by Gallery cleanup");

console.log("coworking gallery smoke: OK");
