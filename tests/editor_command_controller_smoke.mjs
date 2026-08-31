import assert from "node:assert/strict";
import { EditorCommandController } from "../js/editor/EditorCommandController.js?v=1.5.9";

const calls = [];
const toasts = [];
const created = [];
const inserted = [];
const projectSession = {
  active: false,
  isProjectActive() { return this.active; },
  async saveNow() { calls.push("project:save"); },
  async openStandaloneAst(ast, options) { calls.push(["standalone:open", ast, options]); },
  snapshot() { return { activeProjectId: null, project: null, activePostId: null }; }
};
const draftSession = {
  active: true,
  draft: { id: "old", title: "Old" },
  isActive() { return this.active; },
  async saveNow() { calls.push("draft:save"); },
  async deactivate(options) { calls.push(["draft:deactivate", options]); this.active = false; },
  activate(draft, options) { calls.push(["draft:activate", draft.id, options]); this.active = true; this.draft = draft; }
};
const draftStore = {
  async create(input) {
    created.push(structuredClone(input));
    return { id: `draft_${created.length}`, ...structuredClone(input) };
  }
};
const controller = new EditorCommandController({
  projectSession,
  draftSession,
  draftStore,
  documents: { async saveCurrentContext() { calls.push("context:save"); } },
  tree: { toJSON: () => ({ id: "root", type: "document", props: {}, children: [] }) },
  controller: {
    addBlock(...args) {
      inserted.push(args);
      return { id: "inserted" };
    }
  },
  selection: { clear: () => calls.push("selection:clear") },
  textareaSizing: { clear: () => calls.push("textarea:clear") },
  rightPanel: { showDrafts: () => calls.push("panel:drafts"), getMode: () => "drafts" },
  workspace: { render: () => calls.push("workspace:render") },
  notifications: { show: payload => toasts.push(payload) },
  promptFn: () => "New Draft",
  now: () => new Date("2026-08-20T12:00:00Z")
});

const draft = await controller.createDraft();
assert.equal(draft.title, "New Draft");
assert.deepEqual(calls.slice(0, 3).map(call => Array.isArray(call) ? call[0] : call), [
  "context:save", "draft:deactivate", "standalone:open"
]);
assert.deepEqual(created[0].source, { kind: "draft" });
assert.equal(created[0].messageAst.children.length, 0);
assert.equal(toasts.at(-1).type, "success");

calls.length = 0;
await controller.saveDocument();
assert.deepEqual(calls, ["draft:save"]);

calls.length = 0;
draftSession.active = false;
const saved = await controller.saveDraft();
assert.equal(saved, null, "an unnamed standalone Canvas can no longer be saved");

calls.length = 0;
const firstBlockDraft = await controller.requestDraftForBlock({
  type: "paragraph",
  parentId: "root",
  index: Infinity,
  options: { props: { text: "Первый блок" }, select: true }
});
assert.equal(firstBlockDraft.id, "inserted");
assert.equal(created[1].messageAst.children.length, 0);
assert.deepEqual(created[1].source, { kind: "draft" });
assert.equal(inserted[0][0], "paragraph");
assert.equal(inserted[0][3].props.text, "Первый блок");
assert.equal(calls[0], "context:save");

console.log("editor_command_controller_smoke: OK");
