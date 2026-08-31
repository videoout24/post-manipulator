import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { GalleryCore } from "../js/gallery/GalleryCore.js?v=1.5.9";

const events = new EventBus();
const uploaded = [];
const deleted = [];
const file = new Blob(["image"], { type: "image/png" });
Object.defineProperty(file, "name", { value: "image.png" });
let storedAsset = null;
const core = new GalleryCore({
  db: { async get(_store, _key, fallback) { return { ...fallback, deleteSourceAfterIndexing: true }; } },
  events,
  telegramCore: {
    owner: { async getOwner() { return { chatId: 123 }; } },
    media: { onReceived: () => () => {} },
    topics: { onObserved: () => () => {} }
  },
  client: {
    async uploadMedia(options) {
      uploaded.push(options);
      return {
        message_id: 77,
        message_thread_id: 9,
        chat: { id: 123 },
        caption: options.caption,
        photo: [{ file_id: "small", file_unique_id: "u1", width: 90, height: 90 }, { file_id: "large", file_unique_id: "u2", width: 900, height: 900 }]
      };
    },
    async deleteMessage(chatId, messageId) { deleted.push([chatId, messageId]); }
  },
  store: {
    async ensureTopicPlaceholder() {},
    async ingest(media) {
      storedAsset = { id: "asset_1", ...media, source: { ...media.source, messageDeleted: false } };
      return storedAsset;
    },
    async update(_id, patch) {
      storedAsset = { ...storedAsset, source: { ...storedAsset.source, ...patch.source } };
      return storedAsset;
    }
  },
  thumbnails: {}
});

const result = await core.uploadFiles([file], { threadId: 9, caption: "Same caption" });
assert.equal(result.assets.length, 1);
assert.equal(uploaded[0].messageThreadId, 9);
assert.equal(uploaded[0].caption, "Same caption");
assert.equal(result.assets[0].fileId, "large");
assert.equal(result.assets[0].source.threadId, 9);
assert.equal(result.assets[0].source.messageDeleted, true);
assert.deepEqual(deleted, [[123, 77]]);

console.log("gallery_pc_upload_smoke: OK");
