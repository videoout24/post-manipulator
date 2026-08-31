import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { EditorSessionHistory } from "../js/editor/EditorSessionHistory.js?v=1.5.9";

const events = new EventBus();
const tree = new BlockTree();
const selection = { clears: 0, clear() { this.clears += 1; } };
const listeners = new Map();
const documentRoot = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); }
};
const button = () => ({
  disabled: false,
  addEventListener() {},
  removeEventListener() {},
  setAttribute() {}
});
const undoButton = button();
const redoButton = button();
const projectSession = {
  activeProjectId: null,
  activePostId: null,
  isProjectActive() { return Boolean(this.activeProjectId); }
};
const draftSession = {
  activeDraftId: null,
  isActive() { return Boolean(this.activeDraftId); }
};
const history = new EditorSessionHistory({
  tree,
  events,
  selection,
  projectSession,
  draftSession,
  documentRoot,
  undoButton,
  redoButton,
  limit: 2,
  contextLimit: 2
}).start();

const change = (text, source = "property") => {
  tree.root.children = [{ id: "paragraph", type: "paragraph", props: { text }, children: [] }];
  events.emit("tree:changed", { source });
};

change("one");
change("two");
assert(history.canUndo(), "standalone changes must be undoable");
assert.equal(undoButton.disabled, false, "Undo button must reflect available history");
let prevented = false;
listeners.get("keydown")?.({
  key: "z",
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: { closest: () => false },
  preventDefault() { prevented = true; }
});
assert.equal(prevented, true, "Ctrl/Cmd + Z must use session history");
assert.equal(tree.root.children.length, 0, "rapid property changes coalesce into one undo step");
assert.equal(history.redo(), true);
assert.equal(tree.root.children[0].props.text, "two");

projectSession.activeProjectId = "project_a";
projectSession.activePostId = "post_a";
tree.root = { id: "root", type: "document", props: {}, children: [] };
events.emit("project:session-changed", {});
change("project", "insert");
assert.equal(tree.root.children[0].props.text, "project");
assert.equal(history.undo(), true);
assert.equal(tree.root.children.length, 0, "project history is independent from standalone history");

projectSession.activeProjectId = null;
projectSession.activePostId = null;
tree.root = { id: "root", type: "document", props: {}, children: [{ id: "paragraph", type: "paragraph", props: { text: "two" }, children: [] }] };
events.emit("project:session-changed", {});
assert.equal(history.canUndo(), true, "returning to standalone restores its session-only history");
assert(selection.clears >= 2, "history restores clear stale block selection");

history.stop();
console.log("editor session history smoke: OK");
