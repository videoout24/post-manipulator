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
const canvasScrollSpeedSelect = {
  value: "3",
  addEventListener(_name, handler) { this.change = handler; }
};
const preferenceUpdates = [];
const editorCanvasPreferences = {
  autoCollapseInactive: false,
  scrollSpeed: 2,
  async setAutoCollapseInactive(value) { preferenceUpdates.push(["collapse", value]); },
  async setScrollSpeed(value) { preferenceUpdates.push(["scroll", value]); }
};
let allCollapsed = false;
const statsRoot = {
  children: [],
  replaceChildren(...nodes) { this.children = nodes; }
};
const canvasScroller = { scrollTop: 480 };
const canvasRoot = { closest: selector => selector === ".canvas-panel" ? canvasScroller : null };
const documentRoot = {
  createElement: () => ({ className: "", textContent: "", title: "" }),
  querySelector: selector => selector === "#canvas" ? canvasRoot : null
};
const workspace = new EditorWorkspaceView({
  tree,
  controller,
  validator: { stats: () => ({ blockCount: 9, maxBlocks: 10, maxDepth: 6, maxDepthLimit: 5 }) },
  treeView: {
    render: () => calls.push("tree:render"),
    updateSelection: () => calls.push("tree:selection"),
    setAutoCollapseInactive: value => calls.push(["tree:auto-collapse", value]),
    setScrollSpeed: value => calls.push(["tree:scroll-speed", Number(value)]),
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
  canvasScrollSpeedSelect,
  editorCanvasPreferences,
  statsRoot,
  documentRoot
});

workspace.render();
workspace.scrollCanvasToTop();
assert.equal(canvasScroller.scrollTop, 0, "opening a Draft must place the Canvas scroll container at its top");
assert.equal(blockPaletteMode.hidden, true);
assert.equal(assetPickerMode.hidden, false);
assert(calls.some(call => Array.isArray(call) && call[0] === "picker:set" && call[1] === mediaNode.id));
assert.equal(statsRoot.children[0].className, "canvas-stat warning");
assert.equal(statsRoot.children[1].className, "canvas-stat invalid");
assert.equal(toggleAllBlocksButton.textContent, t("editor.editorWorkspaceView.collapseAll"));
assert.equal(autoCollapseInactiveCheckbox.checked, false, "Global editor preference must restore the checkbox state");
assert(calls.some(call => Array.isArray(call) && call[0] === "tree:auto-collapse" && call[1] === false));
assert.equal(canvasScrollSpeedSelect.value, "2");
assert(calls.some(call => Array.isArray(call) && call[0] === "tree:scroll-speed" && call[1] === 2));
autoCollapseInactiveCheckbox.checked = true;
autoCollapseInactiveCheckbox.change();
await Promise.resolve();
assert.deepEqual(preferenceUpdates, [["collapse", true]]);
assert(calls.some(call => Array.isArray(call) && call[0] === "tree:auto-collapse" && call[1] === true));
canvasScrollSpeedSelect.value = "0";
canvasScrollSpeedSelect.change();
await Promise.resolve();
assert.deepEqual(preferenceUpdates.at(-1), ["scroll", 0]);
assert.deepEqual(calls.at(-1), ["tree:scroll-speed", 0]);
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
