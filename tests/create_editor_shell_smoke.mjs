import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { createEditorShell } from "../js/app/createEditorShell.js?v=1.5.9";

const projectLibraryRoot = {};
const previewStateRoot = { dataset: {}, textContent: "", title: "" };
const listeners = [];
const documentRoot = {
  querySelector: selector => ({
    "#projectLibrary": projectLibraryRoot,
    "#editorPreviewState": previewStateRoot
  })[selector] || null,
  querySelectorAll: () => [],
  addEventListener: (name, handler) => listeners.push([name, handler]),
  removeEventListener() {}
};
const events = new EventBus();
const textareaSizing = { clear() {} };
const workspaceView = {
  renders: 0,
  selections: 0,
  render() { this.renders += 1; },
  updateSelection() { this.selections += 1; }
};
const notices = [];
const notifications = { show: payload => notices.push(payload) };
const projectSession = {
  activeProjectId: null,
  isProjectActive: () => false
};
const editor = {
  tree: {},
  controller: {},
  selection: {},
  validator: {},
  renderer: {},
  draftStore: {},
  draftSession: { isActive: () => false },
  metaRegistry: {},
  registry: {}
};
const project = {
  store: {},
  index: {},
  session: projectSession,
  graphReconciler: {},
  buildPreviewTree: () => ({})
};
const telegram = {
  core: { editor: { preview: {} } },
  navigation: {}
};
const gallery = { core: {}, thumbnails: {} };
const workspace = {
  inlineProperties: { textareaSizing },
  palette: {},
  workspace: workspaceView,
  openAssetPickerButton: null
};
const documents = {};
const projectPreviewSync = {};

const shell = createEditorShell({
  documentRoot,
  events,
  notifications,
  editor,
  project,
  telegram,
  gallery,
  workspace,
  documents,
  projectPreviewSync,
  promptFn: () => null,
  alertFn: () => {}
});

assert(Object.isFrozen(shell));
assert(Object.isFrozen(shell.stoppables));
assert.equal(shell.navigation.root, documentRoot);
assert.equal(shell.eventCoordinator.workspace, workspaceView);
assert.equal(shell.eventCoordinator.textareaSizing, textareaSizing);
assert.equal(shell.telegramControls.previewSync, projectPreviewSync);
assert.equal(shell.rightPanel.documents, documents);
assert.equal(shell.projectLibrary.root, projectLibraryRoot);
assert.equal(shell.projectLibrary.gallery, gallery.core);
assert.equal(shell.commands.rightPanel, shell.rightPanel);
assert.equal(shell.tools.workspace, workspaceView);
assert(listeners.some(([name]) => name === "keydown"), "editor tools must bind document shortcuts");

shell.navigation.onEditor();
assert.equal(workspaceView.renders, 1);
events.emit("selection:changed");
assert.equal(workspaceView.selections, 1);

shell.rightPanel.onError(new Error("broken"));
assert.deepEqual(notices[0], { message: "Editor panel: broken", type: "error", silent: true });
for (const service of [
  shell.previewStatus,
  shell.navigation,
  shell.eventCoordinator,
  shell.telegramControls,
  shell.rightPanel,
  shell.projectLibrary,
  shell.commands,
  shell.tools
]) assert(shell.stoppables.includes(service), `${service.constructor.name} must be stopped by AppLifecycle`);

for (const service of shell.stoppables) service.stop?.();
console.log("create_editor_shell_smoke: OK");
