import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { EditorPreviewStatusView } from "../js/editor/EditorPreviewStatusView.js?v=1.5.9";

const events = new EventBus();
const root = { dataset: {}, textContent: "", title: "" };
const notices = [];
const projectSession = {
  active: false,
  activeProjectId: "project_a",
  project: { posts: [{ id: "post_a" }, { id: "post_b" }] },
  isProjectActive() { return this.active; }
};
const view = new EditorPreviewStatusView({
  root,
  events,
  projectSession,
  notifications: { show: payload => notices.push(payload) }
}).start();

events.emit("telegram:live-preview-setting", { enabled: false });
assert.equal(root.textContent, "Preview: выкл.");
assert.equal(root.dataset.state, "idle");

events.emit("telegram:preview-status", { state: "error", message: "Недоступно" });
events.emit("telegram:preview-status", { state: "error", message: "Недоступно" });
assert.equal(root.textContent, "Preview: ×");
assert.equal(notices.length, 1, "identical preview errors must produce one notice");

events.emit("telegram:preview-status", { state: "synced" });
events.emit("telegram:preview-status", { state: "error", message: "Недоступно" });
assert.equal(notices.length, 2, "a successful sync must reset preview error deduplication");

projectSession.active = true;
events.emit("project:preview-sync", { projectId: "other", state: "materializing", current: 1, total: 2 });
assert.equal(root.textContent, "Preview: ×", "other Project updates must be ignored");
events.emit("project:preview-sync", { projectId: "project_a", state: "materializing", current: 1, total: 2 });
assert.equal(root.textContent, "Project: …");
assert.equal(root.dataset.state, "syncing");
assert.equal(root.title, "Project channel: выгрузка 1/2");

view.showProjectDeployment({ posts: [{ deployments: { preview: { messageId: 42 } } }] });
assert.equal(root.textContent, "Project: ✓");
assert.equal(root.dataset.state, "synced");

view.stop();
events.emit("project:preview-sync", { projectId: "project_a", state: "error" });
assert.equal(root.textContent, "Project: ✓", "stopped view must not react to events");

console.log("editor_preview_status_view_smoke: OK");
