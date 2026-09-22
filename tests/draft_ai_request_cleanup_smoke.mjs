import assert from "node:assert/strict";
import { DraftStore } from "../js/editor/DraftStore.js";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  store(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name);
  }
  async get(store, key, fallback = null) {
    return structuredClone(this.store(store).get(String(key)) ?? fallback);
  }
  async put(store, key, value) {
    this.store(store).set(String(key), structuredClone(value));
  }
  async delete(store, key) {
    this.store(store).delete(String(key));
  }
  async deleteMany(entries) {
    for (const { store, key } of entries) this.store(store).delete(String(key));
  }
  async all(store) {
    return [...this.store(store)].map(([key, value]) => ({ key, value: structuredClone(value) }));
  }
}

const emptyAst = { id: "root", type: "document", props: {}, children: [] };
const aiRequest = draftId => ({
  requestId: `request-${draftId}`,
  target: { kind: "draft", draftId },
  scope: { kind: "message" },
  createdAt: Date.now()
});

const db = new MemoryDb();
const drafts = new DraftStore({ db });
await drafts.restore({ id: "deleted-draft", title: "Delete me", messageAst: emptyAst });
await drafts.restore({ id: "kept-draft", title: "Keep me", messageAst: emptyAst });
await db.put("runtime", "ai.request:deleted-1", aiRequest("deleted-draft"));
await db.put("runtime", "ai.request:deleted-2", aiRequest("deleted-draft"));
await db.put("runtime", "ai.request:kept", aiRequest("kept-draft"));
await db.put("runtime", "ai.request:project", {
  target: { kind: "project-post", projectId: "project-1", postId: "deleted-draft" }
});
await db.put("runtime", "gallery.transfer:deleted-draft", { target: { kind: "draft", draftId: "deleted-draft" } });

await drafts.delete("deleted-draft");
assert.equal(await db.get("drafts", "deleted-draft"), null);
assert.equal(await db.get("runtime", "ai.request:deleted-1"), null);
assert.equal(await db.get("runtime", "ai.request:deleted-2"), null);
assert.notEqual(await db.get("runtime", "ai.request:kept"), null,
  "deleting one draft must preserve another draft's pending AI request");
assert.notEqual(await db.get("runtime", "ai.request:project"), null,
  "draft cleanup must preserve project-post AI requests");
assert.notEqual(await db.get("runtime", "gallery.transfer:deleted-draft"), null,
  "draft cleanup must not delete unrelated runtime records");

await db.put("runtime", "ai.request:orphan", aiRequest("missing-draft"));
const cleaned = await drafts.cleanupOrphanedAiRequests();
assert.equal(cleaned, 1);
assert.equal(await db.get("runtime", "ai.request:orphan"), null,
  "startup cleanup must remove AI requests whose source draft no longer exists");
assert.notEqual(await db.get("runtime", "ai.request:kept"), null,
  "startup cleanup must preserve requests for existing drafts");

console.log("draft_ai_request_cleanup_smoke: OK");
