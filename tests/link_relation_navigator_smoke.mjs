import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { LinkRelationNavigator, projectPostAddress } from "../js/links/LinkRelationNavigator.js?v=1.5.9";

const events = new EventBus();
const calls = [];
const target = { kind: "draft", id: "target_draft", title: "Цель" };
const relations = [
  {
    id: "old_draft_source",
    target,
    source: { kind: "draft", id: "draft_source", nodeId: "draft_node" },
    createdAt: 1
  },
  {
    id: "new_project_source",
    target,
    source: { kind: "project_post", id: "project_source:post_source", nodeId: "project_node" },
    updatedAt: 2
  }
];
const openedPublicationDrafts = [];
const openedRelations = [];
events.on("publication:edit-draft-requested", draft => openedPublicationDrafts.push(draft));
events.on("links:source-opened", payload => openedRelations.push(payload));

const navigator = new LinkRelationNavigator({
  events,
  linkRelations: { async list() { return structuredClone(relations); } },
  documents: {
    async openDraft(id) { calls.push(["draft", id]); },
    async openProjectPost(projectId, postId) { calls.push(["project", projectId, postId]); }
  },
  publications: {
    async createEditDraft(id) {
      calls.push(["publication", id]);
      return { id: "publication_edit_draft", source: { publicationId: id } };
    }
  },
  navigation: { activateTab(tab) { calls.push(["tab", tab]); } },
  controller: {
    tree: { find(id) { return id ? { id } : null; } },
    select(id) { calls.push(["select", id]); }
  }
}).start();

// A green target-card click opens its newest source rather than unlinking it.
events.emit("links:open-linked-source-requested", target);
await tick();
assert.deepEqual(calls, [
  ["project", "project_source", "post_source"],
  ["tab", "editor"],
  ["select", "project_node"]
]);
assert.equal(openedRelations.at(-1)?.relation?.id, "new_project_source");
assert.equal(openedRelations.at(-1)?.focused, true);

calls.length = 0;
await navigator.openRelation({
  id: "publication_source",
  source: { kind: "publication", id: "publication_1", nodeId: "publication_node" }
});
assert.deepEqual(calls, [
  ["publication", "publication_1"],
  ["tab", "editor"],
  ["select", "publication_node"]
]);
assert.deepEqual(openedPublicationDrafts, [{ id: "publication_edit_draft", source: { publicationId: "publication_1" } }]);

assert.deepEqual(projectPostAddress({ projectId: "project_new", postId: "post_new" }), { projectId: "project_new", postId: "post_new" });
assert.deepEqual(projectPostAddress({ id: "project_old:post_old" }), { projectId: "project_old", postId: "post_old" });
assert.equal(projectPostAddress({ id: "invalid" }), null);

navigator.stop();
console.log("link_relation_navigator_smoke: OK");

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}
