import assert from "node:assert/strict";
import { GalleryView } from "../js/gallery/GalleryView.js?v=1.7.6";

const listeners = new Map();
const openButton = {
  addEventListener(name, handler) { listeners.set(name, handler); }
};
const root = {
  innerHTML: "",
  isConnected: true,
  contains() { return false; },
  querySelector(selector) { return selector === "#galleryOpenBot" ? openButton : null; },
  querySelectorAll() { return []; }
};
globalThis.document = { activeElement: null };

let opened = 0;
const view = new GalleryView({
  root,
  gallery: {
    start() {},
    async listAssets() { return []; },
    async listTopics() { return []; },
    async getSettings() { return { deleteSourceAfterIndexing: false }; }
  },
  thumbnails: {
    async stats() { return { count: 0 }; }
  },
  navigation: {
    openBot() { opened += 1; return true; }
  }
});

await view.initialize();
assert(root.innerHTML.indexOf('id="galleryOpenBot"') < root.innerHTML.indexOf('id="galleryUploadFiles"'));
assert.equal(typeof listeners.get("click"), "function");
listeners.get("click")();
assert.equal(opened, 1);

console.log("gallery_open_bot_smoke: OK");
