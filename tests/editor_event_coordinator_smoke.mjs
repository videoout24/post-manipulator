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
    renderStats: () => calls.push("workspace:stats"),
    updateSelection: () => calls.push("workspace:selection")
  },
  selection: { clear: () => calls.push("selection:clear") },
  textareaSizing: { clear: () => calls.push("textarea:clear") },
  projectIndex: { rebuild: project => calls.push(["index:rebuild", project?.id || null]) },
  previewStatus: { showProjectDeployment: project => calls.push(["project:deployment", project.id]) }
}).start();

events.emit("tree:changed", { source: "property" });
assert.deepEqual(calls, ["draft:autosave", "preview:schedule", "workspace:stats"]);

calls.length = 0;
events.emit("tree:changed", { source: "insert" });
assert.deepEqual(calls, ["draft:autosave", "preview:schedule", "workspace:render"]);

calls.length = 0;
projectSession.active = true;
draftSession.active = false;
events.emit("project:session-changed", { project: { id: "project_a" } });
assert.deepEqual(calls, [
  "selection:clear",
  "textarea:clear",
  ["index:rebuild", "project_a"],
  "workspace:render",
  ["project:deployment", "project_a"]
]);

calls.length = 0;
events.emit("project:changed", { projectId: "other", project: { id: "other" }, reason: "saved" });
events.emit("project:changed", { projectId: "project_a", project: { id: "project_a" }, reason: "saved" });
assert.deepEqual(calls, [["index:rebuild", "project_a"]]);

calls.length = 0;
events.emit("selection:changed", {});
assert.deepEqual(calls, ["workspace:selection"]);
coordinator.stop();
events.emit("selection:changed", {});
assert.deepEqual(calls, ["workspace:selection"]);

console.log("editor_event_coordinator_smoke: OK");
