import assert from "node:assert/strict";
import { DraftStore } from "../js/editor/DraftStore.js";
import { PublicationService } from "../js/telegram/PublicationService.js";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { return structuredClone(this.store(store).get(key) ?? fallback); }
  async put(store, key, value) { this.store(store).set(key, structuredClone(value)); }
  async delete(store, key) { this.store(store).delete(key); }
  async all(store) { return [...this.store(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const ast = text => ({
  id: "root", type: "document", props: {},
  children: [{ id: `paragraph_${text}`, type: "paragraph", props: { text }, children: [] }]
});
const db = new MemoryDb();
const drafts = new DraftStore({ db });
let remoteState = "present";
const client = {
  async editRichMessage() {
    if (remoteState === "present") throw { isNotModified: () => true, isMessageMissing: () => false };
    throw { isNotModified: () => false, isMessageMissing: () => true };
  }
};
const service = new PublicationService({
  db, drafts, client,
  renderer: { renderEnvelope: () => ({ richMessage: { blocks: [] }, replyMarkup: null }) },
  validator: { validate: () => [] }
});

async function seed(suffix) {
  const draftId = `draft_${suffix}`;
  const publicationId = `publication_${suffix}`;
  const messageAst = ast(suffix);
  await drafts.restore({
    id: draftId,
    title: `Draft ${suffix}`,
    messageAst,
    source: {
      kind: "publication",
      publicationId,
      retained: true,
      originalSource: { kind: "draft" },
      chatId: -1001,
      messageId: 10,
      targetTitle: "News",
      publicationAst: messageAst
    }
  });
  await db.put("publications", publicationId, {
    id: publicationId,
    source: { kind: "draft", draftId, title: `Draft ${suffix}` },
    target: { title: "News" },
    chatId: -1001,
    messageId: 10,
    messageAst
  });
  return { draftId, publicationId };
}

const kept = await seed("keep");
assert.equal((await service.inspectDraftPublication(kept.draftId)).state, "present");
remoteState = "missing";
assert.equal((await service.inspectDraftPublication(kept.draftId)).state, "missing");
await service.resolveMissingDraftPublication(kept.draftId, { deleteDraft: false });
assert.equal(await db.get("publications", kept.publicationId), null, "keeping removes the stale Publications card");
assert.deepEqual((await drafts.get(kept.draftId)).source, { kind: "draft" }, "keeping clears the publication link");

const removed = await seed("delete");
await service.resolveMissingDraftPublication(removed.draftId, { deleteDraft: true });
assert.equal(await db.get("publications", removed.publicationId), null, "deleting removes the stale Publications card");
assert.equal(await drafts.get(removed.draftId), null, "deleting also removes the draft from the editor");

service.stop();
console.log("draft_publication_missing_resolution_smoke: OK");
