import assert from "node:assert/strict";
import { LinkRelationStore, LINK_RELATION_STATUS } from "../js/links/LinkRelationStore.js?v=1.5.9";

const values = new Map();
const db = {
  async get(store, key, fallback) { return values.get(`${store}:${key}`) ?? fallback; },
  async put(store, key, value) { values.set(`${store}:${key}`, structuredClone(value)); },
  async delete(store, key) { values.delete(`${store}:${key}`); },
  async all(store) { return [...values].filter(([key]) => key.startsWith(`${store}:`)).map(([, value]) => ({ value: structuredClone(value) })); }
};
await db.put("publications", "pub_target", { chatId: -1001234567890, messageId: 77 });
const store = new LinkRelationStore({ db });
const relation = await store.create({ source: { kind: "draft", id: "draft_1" }, target: { kind: "publication", id: "pub_target" } });
assert.equal(relation.status, LINK_RELATION_STATUS.RESOLVED);
assert.equal(relation.resolvedUrl, "https://t.me/c/1234567890/77");
const external = await store.create({ source: { kind: "draft", id: "draft_1" }, target: { kind: "external", url: "https://t.me/example/3" } });
assert.equal(external.status, LINK_RELATION_STATUS.RESOLVED);
const pending = await store.create({ source: { kind: "draft", id: "draft_1" }, target: { kind: "publication", id: "pub_later" } });
assert.equal(pending.status, LINK_RELATION_STATUS.PENDING);
await db.put("publications", "pub_later", { chatId: -1009876543210, messageId: 9 });
const resolved = await store.resolveWaitingForPublication("pub_later");
assert.equal(resolved[0].resolvedUrl, "https://t.me/c/9876543210/9");
const draftTarget = await store.create({ source: { kind: "draft", id: "draft_source" }, target: { kind: "draft", id: "draft_later" } });
assert.equal(draftTarget.status, LINK_RELATION_STATUS.PENDING);
const publicationFromDraft = {
  id: "publication_from_draft",
  source: { kind: "draft", draftId: "draft_later" },
  chatId: -1001122334455,
  messageId: 21
};
await db.put("publications", publicationFromDraft.id, publicationFromDraft);
const resolvedDraft = await store.resolveWaitingForPublication(publicationFromDraft);
assert.equal(resolvedDraft.find(item => item.id === draftTarget.id)?.resolvedUrl, "https://t.me/c/1122334455/21");
assert.equal((await store.get(draftTarget.id)).target.kind, "publication");
assert.equal((await store.get(draftTarget.id)).target.id, publicationFromDraft.id);
await store.bindSourceDraftToPublication("draft_source", publicationFromDraft.id);
assert.deepEqual((await store.get(draftTarget.id)).source.kind, "publication");
assert.equal((await store.get(draftTarget.id)).source.id, publicationFromDraft.id);
const scheduledTarget = await store.create({
  source: { kind: "draft", id: "other_draft" },
  target: { kind: "publication", id: "scheduled_publication" }
});
await store.bindTargetPublicationToDraft("scheduled_publication", "restored_draft");
assert.equal((await store.get(scheduledTarget.id)).target.kind, "draft");
assert.equal((await store.get(scheduledTarget.id)).target.id, "restored_draft");
assert.equal((await store.get(scheduledTarget.id)).status, LINK_RELATION_STATUS.PENDING);
console.log("link_relation_store_smoke: OK");
