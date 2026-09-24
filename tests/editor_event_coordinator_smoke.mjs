import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { EditorEventCoordinator } from "../js/editor/EditorEventCoordinator.js?v=1.5.9";

const events = new EventBus();
const calls = [];
const projectSession = {
  active: false,
  activeProjectId: "project_a",
  isProjectActive() { return this.active; },
  scheduleAutosave() { calls.push("project:autosave"); }
};
const draftSession = {
  active: true,
  isActive() { return this.active; },
  scheduleAutosave() { calls.push("draft:autosave"); }
};
const coordinator = new EditorEventCoordinator({
  events,
  projectSession,
  draftSession,
  telegramPreview: { schedule: () => calls.push("preview:schedule") },
  workspace: {
    render: () => calls.push("workspace:render"),
    scrollCanvasToTop: () => calls.push("workspace:scroll-top"),
    renderStats: () => calls.push("workspace:stats"),
    updateSelection: () => calls.push("workspace:selection"),
    updateCollectorState: () => calls.push("workspace:collector")
  },
  selection: { clear: () => calls.push("selection:clear") },
  textareaSizing: { clear: () => calls.push("textarea:clear") },
  projectIndex: { rebuild: project => calls.push(["index:rebuild", project?.id || null]) },
  previewStatus: { showProjectDeployment: project => calls.push(["project:deployment", project.id]) }
}).start();

events.emit("tree:changed", { source: "property" });
assert.deepEqual(calls, ["draft:autosave", "preview:schedule", "workspace:stats"]);

calls.length = 0;
events.emit("tree:changed", { source: "property", affectsTelegram: false });
assert.deepEqual(calls, ["draft:autosave", "workspace:stats"],
  "AI-only metadata changes must autosave without scheduling Telegram live preview");

calls.length = 0;
events.emit("tree:changed", { source: "insert" });
assert.deepEqual(calls, ["draft:autosave", "preview:schedule", "workspace:render"]);

calls.length = 0;
projectSession.active = true;
draftSession.active = false;
events.emit("project:session-changed", { reason: "project-opened", project: { id: "project_a" }, activePostId: "post_a" });
assert.deepEqual(calls, [
  "selection:clear",
  "textarea:clear",
  ["index:rebuild", "project_a"],
  "workspace:render",
  "workspace:scroll-top",
  ["project:deployment", "project_a"]
]);

calls.length = 0;
events.emit("project:session-changed", { reason: "saved", project: { id: "project_a" }, activePostId: "post_a" });
assert.deepEqual(calls, [
  "selection:clear", "textarea:clear", ["index:rebuild", "project_a"], "workspace:render", ["project:deployment", "project_a"]
], "saving the same Project post must not move Canvas");

calls.length = 0;
events.emit("project:session-changed", { reason: "post-opened", project: { id: "project_a" }, activePostId: "post_b" });
assert.deepEqual(calls, [
  "selection:clear", "textarea:clear", ["index:rebuild", "project_a"], "workspace:render", "workspace:scroll-top", ["project:deployment", "project_a"]
], "switching the Canvas to another Project post must reset scroll");

calls.length = 0;
events.emit("project:changed", { projectId: "other", project: { id: "other" }, reason: "saved" });
events.emit("project:changed", { projectId: "project_a", project: { id: "project_a" }, reason: "saved" });
assert.deepEqual(calls, [["index:rebuild", "project_a"]]);

calls.length = 0;
projectSession.active = false;
draftSession.active = true;
events.emit("draft:session-changed", { reason: "opened", activeDraftId: "draft_a" });
assert.deepEqual(calls, ["workspace:render", "workspace:scroll-top", "preview:schedule"],
  "opening a Draft must render it and reset the Canvas scroll position");

calls.length = 0;
events.emit("draft:session-changed", { reason: "saved", activeDraftId: "draft_a" });
assert.deepEqual(calls, ["workspace:render", "preview:schedule"],
  "saving an already open Draft must not unexpectedly move the Canvas");

calls.length = 0;
events.emit("draft:session-changed", { reason: "synced-from-channel", activeDraftId: "draft_a" });
assert.deepEqual(calls, ["workspace:render", "workspace:scroll-top", "preview:schedule"],
  "reloading a CoMessage channel snapshot must reset Canvas scroll");

calls.length = 0;
events.emit("selection:changed", {});
assert.deepEqual(calls, ["workspace:selection"]);
calls.length = 0;
events.emit("block-collector:changed", {});
assert.deepEqual(calls, ["workspace:collector"]);
coordinator.stop();
events.emit("selection:changed", {});
assert.deepEqual(calls, ["workspace:collector"]);

console.log("editor_event_coordinator_smoke: OK");
