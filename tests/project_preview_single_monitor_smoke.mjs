import assert from "node:assert/strict";
import { ProjectPreviewSync } from "../js/project/ProjectPreviewSync.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

const projects = [
  { id: "project_a", title: "A", posts: [{ deployments: { preview: { chatId: -1001, messageId: 11 } } }] },
  { id: "project_b", title: "B", posts: [{ deployments: {} }] },
  { id: "project_c", title: "C", posts: [{ deployments: { preview: { chatId: -1001, messageId: 31 } } }] }
];
const sync = new ProjectPreviewSync({
  store: { async listProjects() { return structuredClone(projects); } },
  compiler: {},
  validator: {},
  transport: {}
});
const removed = [];
sync.remove = async projectId => {
  removed.push(projectId);
  return { removed: 1, forgotten: 0, failed: [], remaining: 0, partial: false };
};

const result = await sync.clearAllDeployments();
assert.deepEqual(removed, ["project_a", "project_c"]);
assert.equal(result.projectCount, 2);
assert.equal(result.removed, 2);

sync.remove = async projectId => ({
  removed: 0,
  forgotten: 0,
  failed: [{ postId: "post", message: "failed" }],
  remaining: 1,
  partial: true,
  projectId
});
await assert.rejects(
  () => sync.clearAllDeployments(),
  error => error.message === t("project.projectPreviewSync.failedToCompletelyClearProjectUploadRemaining", { 0: "A", 1: 1 })
);

console.log("project_preview_single_monitor_smoke: OK");
