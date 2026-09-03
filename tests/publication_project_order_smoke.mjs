import assert from "node:assert/strict";
import {
  countPublishedPosts,
  publishedProjectOptions,
  sortProjectPublications
} from "../js/publications/PublicationView.js?v=1.8.2";

const publication = (id, projectId, postId) => ({
  id,
  source: { kind: "project", projectId, postId }
});

// The service supplies newest publications first. Once the Project source filter
// is active, projects stay ordered by their newest visible record, while every
// project's records follow its current Map order with the root post first.
const newestFirst = [
  publication("b-2", "project-b", "b-2"),
  publication("a-3", "project-a", "a-3"),
  publication("b-root", "project-b", "b-root"),
  publication("a-root", "project-a", "a-root"),
  publication("a-2", "project-a", "a-2")
];
const orders = new Map([
  ["project-a", new Map([["a-root", 0], ["a-2", 1], ["a-3", 2]])],
  ["project-b", new Map([["b-root", 0], ["b-2", 1]])]
]);

assert.deepEqual(
  sortProjectPublications(newestFirst, orders).map(record => record.id),
  ["b-root", "b-2", "a-root", "a-2", "a-3"]
);
assert.deepEqual(
  sortProjectPublications([publication("orphan-2", "orphan", "2"), publication("orphan-1", "orphan", "1")], orders)
    .map(record => record.id),
  ["orphan-2", "orphan-1"],
  "unknown/deleted projects keep the service order"
);

const projectRows = [
  { chatId: -1001, messageId: 10, source: { kind: "project", projectId: "a", projectTitle: "Alpha" } },
  { chatId: -1001, messageId: 11, source: { kind: "project", projectId: "a", projectTitle: "Alpha" } },
  { chatId: -1001, messageId: 12, source: { kind: "project", projectId: "b", projectTitle: "Beta" } },
  { chatId: -1001, scheduledAt: Date.now(), source: { kind: "project", projectId: "scheduled", projectTitle: "Later" } },
  { chatId: -1002, messageId: 13, source: { kind: "project", projectId: "other", projectTitle: "Other target" } },
  { chatId: -1001, messageId: 14, source: { kind: "draft", title: "Draft" } }
];
assert.deepEqual(publishedProjectOptions(projectRows, -1001), [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta" }
]);
assert.equal(countPublishedPosts(projectRows, -1001), 4);

console.log("publication_project_order_smoke: OK");
