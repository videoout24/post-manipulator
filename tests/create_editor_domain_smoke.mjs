import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { createEditorDomain } from "../js/app/createEditorDomain.js?v=1.5.9";

const events = new EventBus();
const db = { async get(_store, _key, fallback = null) { return fallback; }, async put() {} };
const saved = {
  id: "root",
  type: "document",
  props: {},
  children: [{ id: "photo", type: "photo", props: { url: "file-id" }, children: [] }]
};
const storage = { load: () => structuredClone(saved), save() {} };
const editor = createEditorDomain({ db, events, storage });

assert(Object.isFrozen(editor));
for (const key of [
  "formatting", "properties", "registry", "metaRegistry", "tree", "validator",
  "selection", "controller", "draftStore", "draftSession", "formulaTemplates", "renderer"
]) assert(editor[key], `${key} must be exposed by the Editor domain`);

assert(editor.registry.has("paragraph"));
assert(editor.registry.has("project_post_map"));
assert.equal(editor.tree.find("photo").props.fileId, "file-id", "legacy document migration must run during composition");
assert.equal(editor.controller.tree, editor.tree);
assert.equal(editor.draftSession.tree, editor.tree);
assert.equal(editor.draftSession.store, editor.draftStore);
assert.equal(editor.renderer.registry, editor.registry);
assert.equal(editor.formulaTemplates.started, true);

console.log("create_editor_domain_smoke: OK");
