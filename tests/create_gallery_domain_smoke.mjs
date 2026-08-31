import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { createGalleryDomain } from "../js/app/createGalleryDomain.js?v=1.5.9";

const events = new EventBus();
const db = { async get(_store, _key, fallback = null) { return fallback; }, async put() {} };
const client = { hasToken: () => false };
const telegramCore = {
  media: { onReceived: () => () => {} },
  topics: { onObserved: () => () => {} }
};
const gallery = createGalleryDomain({ db, events, telegramCore, client });

assert(Object.isFrozen(gallery));
assert(gallery.store);
assert(gallery.thumbnails);
assert(gallery.core);
assert.equal(gallery.thumbnails.client, client);
assert.equal(gallery.core.store, gallery.store);
assert.equal(gallery.core.thumbnails, gallery.thumbnails);
assert.equal(gallery.core.telegramCore, telegramCore);

console.log("create_gallery_domain_smoke: OK");
