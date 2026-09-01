import assert from "node:assert/strict";
import { EditorWorkspaceView } from "../js/editor/EditorWorkspaceView.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

const mediaNode = { id: "photo_a", type: "photo" };
const tree = { find: id => id === mediaNode.id ? mediaNode : null };
const controller = { selectedId: mediaNode.id };
const calls = [];
const blockPaletteMode = { hidden: false };
const assetPickerMode = { hidden: true };
const openAssetPickerButton = { hidden: true };
const toggleAllBlocksButton = {
  disabled: false,
  textContent: "",
  title: "",
  addEventListener(_name, handler) { this.click = handler; }
};
const autoCollapseInactiveCheckbox = {
  checked: true,
  addEventListener(_name, handler) { this.change = handler; }
};
const preferenceUpdates = [];
const editorCanvasPreferences = {
  autoCollapseInactive: false,
  async setAutoCollapseInactive(value) { preferenceUpdates.push(value); }
};
let allCollapsed = false;
const statsRoot = {
  children: [],
  replaceChildren(...nodes) { this.children = nodes; }
};
const documentRoot = {
  createElement: () => ({ className: "", textContent: "", title: "" })
};
const workspace = new EditorWorkspaceView({
  tree,
  controller,
  validator: { stats: () => ({ blockCount: 9, maxBlocks: 10, maxDepth: 6, maxDepthLimit: 5 }) },
  treeView: {
    render: () => calls.push("tree:render"),
    updateSelection: () => calls.push("tree:selection"),
    setAutoCollapseInactive: value => calls.push(["tree:auto-collapse", value]),
    collapseState: () => ({ total: 2, collapsed: allCollapsed ? 2 : 0, allCollapsed }),
    collapseAll: () => { allCollapsed = true; calls.push("tree:collapse-all"); },
    expandAll: () => { allCollapsed = false; calls.push("tree:expand-all"); }
  },
  palette: { render: () => calls.push("palette:render") },
  mediaBinder: { supports: node => node === mediaNode },
  assetPicker: { setNode: id => { calls.push(["picker:set", id]); return Promise.resolve(); } },
  blockPaletteMode,
  assetPickerMode,
  openAssetPickerButton,
  toggleAllBlocksButton,
  autoCollapseInactiveCheckbox,
  editorCanvasPreferences,
  statsRoot,
  documentRoot
});

workspace.render();
assert.equal(blockPaletteMode.hidden, true);
assert.equal(assetPickerMode.hidden, false);
assert(calls.some(call => Array.isArray(call) && call[0] === "picker:set" && call[1] === mediaNode.id));
assert.equal(statsRoot.children[0].className, "canvas-stat warning");
assert.equal(statsRoot.children[1].className, "canvas-stat invalid");
assert.equal(toggleAllBlocksButton.textContent, t("editor.editorWorkspaceView.collapseAll"));
assert.equal(autoCollapseInactiveCheckbox.checked, false, "Global editor preference must restore the checkbox state");
assert(calls.some(call => Array.isArray(call) && call[0] === "tree:auto-collapse" && call[1] === false));
autoCollapseInactiveCheckbox.checked = true;
autoCollapseInactiveCheckbox.change();
await Promise.resolve();
assert.deepEqual(preferenceUpdates, [true]);
assert(calls.some(call => Array.isArray(call) && call[0] === "tree:auto-collapse" && call[1] === true));
toggleAllBlocksButton.click();
assert(calls.includes("tree:collapse-all"));
assert.equal(toggleAllBlocksButton.textContent, t("editor.editorWorkspaceView.expandAll"));
toggleAllBlocksButton.click();
assert(calls.includes("tree:expand-all"));

workspace.suppressAssetPicker(mediaNode.id);
assert.equal(blockPaletteMode.hidden, false);
assert.equal(assetPickerMode.hidden, true);
assert.equal(openAssetPickerButton.hidden, false);
assert(calls.includes("palette:render"));

workspace.showAssetPicker();
assert.equal(assetPickerMode.hidden, false);

controller.selectedId = null;
workspace.updateSelection();
assert(calls.includes("tree:selection"));
assert.equal(openAssetPickerButton.hidden, true);

console.log("editor_workspace_view_smoke: OK");
