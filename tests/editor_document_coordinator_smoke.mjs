import assert from "node:assert/strict";
import { EditorDocumentCoordinator } from "../js/editor/EditorDocumentCoordinator.js?v=1.5.9";

const calls = [];
const draft = { id: "draft_a", title: "Draft A", messageAst: { id: "root", type: "document", props: {}, children: [] } };
const projectSession = {
  active: false,
  isProjectActive() { return this.active; },
  async flush() { calls.push("project:flush"); },
  async openStandaloneAst(ast, options) { calls.push(["standalone:open", ast, options]); },
  async openProject(projectId, options) { calls.push(["project:open", projectId, options]); this.active = true; },
  async refreshProject(options) { calls.push(["project:refresh", options]); }
};
const draftSession = {
  active: true,
  isActive() { return this.active; },
  async flush() { calls.push("draft:flush"); },
  activate(value, options) { calls.push(["draft:activate", value.id, options]); this.active = true; },
  async deactivate(options) { calls.push(["draft:deactivate", options]); this.active = false; }
};
const drafts = {
  async get(id) { calls.push(["draft:get", id]); return structuredClone(draft); },
  async delete(id) { calls.push(["draft:delete", id]); }
};
const projects = {
  async createPost(projectId, input) {
    calls.push(["post:create", projectId, input]);
    return { post: { id: "post_a" } };
  }
};
const graphReconciler = { async reconcile(projectId) { calls.push(["graph:reconcile", projectId]); } };
const coordinator = new EditorDocumentCoordinator({ projectSession, draftSession, drafts, projects, graphReconciler });

await coordinator.openDraft(draft.id);
assert.equal(calls[0], "draft:flush", "current Draft must flush before another Draft opens");
assert.deepEqual(calls.at(-1), ["draft:activate", draft.id, { reason: "opened" }]);

calls.length = 0;
const result = await coordinator.moveDraftToProject(draft.id, "project_a");
assert.equal(result.post.id, "post_a");
assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
  "draft:flush",
  "draft:get",
  "post:create",
  "graph:reconcile",
  "draft:delete",
  "draft:deactivate",
  "project:open",
  "project:refresh"
]);
assert.deepEqual(calls[5][1], { flush: false, reason: "project-opened" });
assert.deepEqual(calls[6][2], { postId: "post_a", reason: "draft-moved-to-project" });

calls.length = 0;
draftSession.active = true;
projectSession.active = false;
await coordinator.openProjectPost("project_link", "post_link");
assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), [
  "draft:flush",
  "draft:deactivate",
  "project:open",
  "project:refresh"
]);
assert.deepEqual(calls[1][1], { flush: false, reason: "project-opened" });
assert.deepEqual(calls[2][2], { postId: "post_link", reason: "link-opened" });
assert.deepEqual(calls[3][1], { reloadActiveAst: true });

calls.length = 0;
draftSession.active = true;
draftSession.activeDraftId = draft.id;
projectSession.active = false;
assert.equal(await coordinator.clearPublishedDraft(draft.id), true);
assert.deepEqual(calls[0], ["draft:deactivate", { flush: false, reason: "published" }]);
assert.deepEqual(calls[1], ["standalone:open", { id: "root", type: "document", props: {}, children: [] }, { reason: "draft-published", persist: false }]);

calls.length = 0;
draftSession.active = true;
draftSession.activeDraftId = draft.id;
assert.equal(await coordinator.clearScheduledDraft(draft.id), true);
assert.deepEqual(calls[0], ["draft:deactivate", { flush: false, reason: "scheduled" }]);
assert.deepEqual(calls[1], ["standalone:open", { id: "root", type: "document", props: {}, children: [] }, { reason: "draft-scheduled", persist: false }]);

calls.length = 0;
draftSession.active = true;
draftSession.activeDraftId = draft.id;
assert.equal(await coordinator.discardDraft(draft.id, { reason: "publication-edit-cancelled" }), true);
assert.deepEqual(calls.map(call => call[0]), ["draft:deactivate", "draft:delete", "standalone:open"]);
assert.deepEqual(calls[0][1], { flush: false, reason: "publication-edit-cancelled" });
assert.deepEqual(calls[2][2], { reason: "publication-edit-cancelled", persist: false });

const recoveredCalls = [];
const recoveredAst = { id: "root", type: "document", props: {}, children: [{ id: "p", type: "paragraph", props: {}, children: [] }] };
const recoveryCoordinator = new EditorDocumentCoordinator({
  projectSession: {
    isProjectActive: () => false,
    async openStandaloneAst(ast, options) { recoveredCalls.push(["standalone:open", ast, options]); }
  },
  draftSession: {
    isActive: () => false,
    activate(value, options) { recoveredCalls.push(["draft:activate", value.id, options]); }
  },
  drafts: {
    async create(input) {
      recoveredCalls.push(["draft:create", input]);
      return { id: "draft_recovered", ...structuredClone(input) };
    }
  },
  tree: { toJSON: () => structuredClone(recoveredAst) },
  storage: { clear() { recoveredCalls.push(["storage:clear"]); } }
});
const recovered = await recoveryCoordinator.initialize();
assert.equal(recovered.id, "draft_recovered");
assert.equal(recoveredCalls[0][0], "draft:create");
assert.deepEqual(recoveredCalls[0][1].source, { kind: "draft" });
assert.deepEqual(recoveredCalls[1], ["standalone:open", recoveredAst, { reason: "standalone-recovered", persist: false }]);
assert.deepEqual(recoveredCalls[2], ["draft:activate", "draft_recovered", { reason: "recovered" }]);

console.log("editor_document_coordinator_smoke: OK");
