import assert from "node:assert/strict";
import { EditorToolController } from "../js/editor/EditorToolController.js?v=1.5.9";

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  emit(name, event = {}) { return this.listeners.get(name)?.(event); }
}

const documentRoot = new FakeTarget();
documentRoot.querySelector = () => null;
const blockSearch = new FakeTarget();
const jsonDialog = { opened: 0, showModal() { this.opened++; }, close() {} };
const jsonOutput = { textContent: "" };
const dialogTitle = { textContent: "" };
const calls = [];
const notices = [];
const tree = { toJSON: () => ({ id: "root", type: "document", props: {}, children: [] }) };
const selection = { all: () => [{ id: "a" }, { id: "b" }] };
const palette = { search: "", render: () => calls.push("palette:render") };
const tools = new EditorToolController({
  documentRoot,
  navigation: { activeTab: "editor" },
  tree,
  controller: { removeSelected: () => calls.push("selection:remove") },
  selection,
  validator: {
    validate: () => [],
    stats: () => ({ blockCount: 0 })
  },
  renderer: { renderEnvelope: () => ({ richMessage: { text: "ok" }, replyMarkup: null }) },
  projectSession: { isProjectActive: () => false },
  buildPreviewTree: () => tree,
  palette,
  workspace: { showAssetPicker: () => calls.push("picker:show") },
  notifications: { show: payload => notices.push(payload) },
  metaDialog: { open: () => calls.push("meta:open"), create: () => calls.push("meta:create") },
  blockSearch,
  jsonDialog,
  jsonOutput,
  dialogTitle,
  alertFn: message => calls.push(["alert", message])
}).start();

let prevented = false;
assert.equal(tools.handleKeydown({
  key: "Delete",
  defaultPrevented: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { closest: () => null },
  preventDefault: () => { prevented = true; }
}), true);
assert(prevented);
assert(calls.includes("selection:remove"));
assert.equal(notices.at(-1).message, "Удалено блоков: 2");

assert.equal(tools.handleKeydown({
  key: "Delete",
  defaultPrevented: false,
  target: { closest: () => ({ tagName: "INPUT" }) }
}), false, "Delete must be ignored while editing a field");

blockSearch.emit("input", { target: { value: "photo" } });
assert.equal(palette.search, "photo");
assert(calls.includes("palette:render"));

tools.exportJson();
assert.equal(dialogTitle.textContent, "Internal AST");
assert.equal(JSON.parse(jsonOutput.textContent).type, "document");

tools.previewTelegram();
const preview = JSON.parse(jsonOutput.textContent);
assert.equal(preview.valid, true);
assert.equal(preview.source, "standalone");
assert.equal(preview.rich_message.text, "ok");
assert.equal(jsonDialog.opened, 2);

tools.stop();
assert.equal(documentRoot.listeners.size, 0);
assert.equal(blockSearch.listeners.size, 0);

console.log("editor_tool_controller_smoke: OK");
