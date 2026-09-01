import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { createTelegramDomain } from "../js/app/createTelegramDomain.js?v=1.5.9";

const events = new EventBus();
const db = {
  async get(_store, _key, fallback = null) { return fallback; },
  async put() {}
};
const renderer = { renderEnvelope() { return {}; } };
const validator = { validate() { return []; } };
const tree = { root: { id: "root", type: "document", props: {}, children: [] } };
const treeProvider = () => tree;
const previewSyncGuard = () => true;
const telegram = createTelegramDomain({ db, events, renderer, validator, tree, treeProvider, previewSyncGuard });
assert.equal(telegram.runtime.serviceMessages, telegram.serviceMessages);
assert.equal(telegram.serviceMessages.publicationTargets, telegram.publicationTargets);

assert(Object.isFrozen(telegram));
for (const key of [
  "client", "botIdentity", "navigation", "ownerBinding", "previewChannelBinding",
  "topics", "runtime", "previewController", "projectPreviewTransport", "core"
]) assert(telegram[key], `${key} must be exposed by the Telegram domain`);

assert.equal(telegram.botIdentity.client, telegram.client);
assert.equal(telegram.runtime.client, telegram.client);
assert.equal(telegram.runtime.ownerBinding, telegram.ownerBinding);
assert.equal(telegram.previewController.treeProvider, treeProvider);
assert.equal(telegram.previewController.syncGuard, previewSyncGuard);
assert.equal(telegram.core.client, telegram.client);
assert.equal(telegram.core.runtime, telegram.runtime);
assert.equal(telegram.core.owner, telegram.ownerBinding);
assert.equal(telegram.core.project.previewChannel, telegram.projectPreviewTransport);
assert.equal(typeof telegram.core.publications.setPinned, "function");
assert.equal(typeof telegram.core.publications.setServiceMessageCleanup, "function");
assert.equal(typeof telegram.core.publications.scheduleDraft, "function");
assert.equal(typeof telegram.core.publications.cancelDraftSchedule, "function");

console.log("create_telegram_domain_smoke: OK");
