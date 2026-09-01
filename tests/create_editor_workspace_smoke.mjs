import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { createEditorWorkspace } from "../js/app/createEditorWorkspace.js?v=1.5.9";

const elements = new Map([
  ["#palette", { id: "palette" }],
  ["#blockCategoryFilters", { id: "blockCategoryFilters" }],
  ["#canvas", { id: "canvas", contains: () => false }],
  ["#blockPaletteMode", { id: "blockPaletteMode" }],
  ["#assetPickerMode", { id: "assetPickerMode" }],
  ["#openAssetPicker", { id: "openAssetPicker" }],
  ["#editorToggleAllBlocks", { id: "editorToggleAllBlocks", addEventListener() {} }],
  ["#canvasStats", { id: "canvasStats" }]
]);
const documentRoot = {
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener() {},
  querySelector: selector => elements.get(selector) || null,
  createElement: () => ({ className: "", textContent: "", title: "" })
};
globalThis.document = documentRoot;

const events = new EventBus();
const tree = { find: () => null };
const registry = {};
const metaRegistry = {};
const controller = {};
const validator = {};
const formulaTemplates = {};
const richTextContext = { active: null };
const projectSession = {};
const dragState = { nodeId: "", type: "", source: "" };
const gallery = {};
const thumbnails = {};
const notices = [];
const notifications = { show: payload => notices.push(payload) };
const emojiPreferences = {};

const composition = createEditorWorkspace({
  documentRoot,
  events,
  tree,
  registry,
  metaRegistry,
  controller,
  validator,
  formulaTemplates,
  richTextContext,
  projectSession,
  dragState,
  gallery,
  thumbnails,
  notifications,
  emojiPreferences
});

assert(Object.isFrozen(composition));
assert.equal(composition.inlineProperties.registry, registry);
assert.equal(composition.inlineProperties.emojiPreferences, emojiPreferences);
assert.equal(composition.palette.root, elements.get("#palette"));
assert.equal(composition.palette.categoryRoot, elements.get("#blockCategoryFilters"));
assert.equal(composition.palette.metaRegistry, metaRegistry);
assert.equal(composition.palette.projectContext, projectSession);
assert.equal(composition.mediaBinder.gallery, gallery);
assert.equal(composition.treeView.inlineInspector, composition.inlineProperties);
assert.equal(composition.assetPicker.binder, composition.mediaBinder);
assert.equal(composition.workspace.treeView, composition.treeView);
assert.equal(composition.workspace.assetPicker, composition.assetPicker);
assert.equal(composition.openAssetPickerButton, elements.get("#openAssetPicker"));

let suppressedNodeId = null;
composition.workspace.suppressAssetPicker = nodeId => { suppressedNodeId = nodeId; };
composition.assetPicker.onBack("photo_1");
assert.equal(suppressedNodeId, "photo_1", "asset picker back action must target the composed workspace");

composition.workspace.onError(new Error("broken"));
assert.deepEqual(notices[0], { message: "Gallery picker: broken", type: "error" });

console.log("create_editor_workspace_smoke: OK");
