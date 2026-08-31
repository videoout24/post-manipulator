import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { LinkingController } from "../js/links/LinkingController.js";

const events = new EventBus();
const nodes = new Map([
  ["source", { id: "source", props: { text: "Текст ссылки" } }]
]);
const slots = [];
events.on("links:target-slot-changed", state => slots.push(state));

let createCalls = 0;
const linking = new LinkingController({
  events,
  tree: { find: id => nodes.get(id) || null },
  controller: {
    updateNodeProperty(nodeId, property, value) { nodes.get(nodeId).props[property] = value; },
    updateNodeProperties(nodeId, values) { Object.assign(nodes.get(nodeId).props, values); }
  },
  linkRelations: {
    async list() { return []; },
    async create() { createCalls += 1; return { id: "must-not-be-created" }; },
    async get() { return null; },
    async remove() { return null; }
  },
  draftSession: {
    activeDraftId: "draft_source",
    draft: { id: "draft_source" }
  }
}).start();

const self = { kind: "draft", id: "draft_source", title: "Текущий черновик" };
assert.equal(slots.at(-1)?.targetKey, "");

// Cards remain ordinary targets, including the current one. The prohibition
// belongs to relation creation, not to the card UI or the waiting slot.
await linking.toggleTarget(self);
assert.deepEqual(linking.getTargetSlot(), self);

// The creation guard is deliberately kept at the persistence boundary: no
// self-link can be written even though the target was selected normally.
await assert.rejects(
  linking.attachInline({ nodeId: "source", property: "text", start: 0, end: 5 }),
  /Нельзя связать сообщение с самим собой/
);
assert.equal(createCalls, 0, "a self-link must not reach persistent storage");
assert.deepEqual(linking.getTargetSlot(), self, "the card selection is untouched after a rejected self-link");

linking.stop();

// The same guard applies to a Project post: its stable compound target key is
// compared with the currently edited parent post before any record is stored.
const projectEvents = new EventBus();
const projectNodes = new Map([
  ["project-source", { id: "project-source", props: { text: "Открыть", url: "" } }]
]);
let projectCreateCalls = 0;
const projectLinking = new LinkingController({
  events: projectEvents,
  tree: { find: id => projectNodes.get(id) || null },
  controller: {
    updateNodeProperty(nodeId, property, value) { projectNodes.get(nodeId).props[property] = value; },
    updateNodeProperties(nodeId, values) { Object.assign(projectNodes.get(nodeId).props, values); }
  },
  linkRelations: {
    async list() { return []; },
    async create() { projectCreateCalls += 1; return { id: "must-not-be-created" }; },
    async get() { return null; },
    async remove() { return null; }
  },
  projectSession: { activeProjectId: "project_1", activePostId: "post_1" }
}).start();

const parentPost = {
  kind: "project_post",
  id: "project_1:post_1",
  projectId: "project_1",
  postId: "post_1",
  title: "Родительский пост"
};
await projectLinking.toggleTarget(parentPost);
await assert.rejects(
  projectLinking.attachBlock({ nodeId: "project-source", text: "Открыть" }),
  /Нельзя связать сообщение с самим собой/
);
assert.equal(projectCreateCalls, 0, "a Project post must not link to itself");
assert.deepEqual(projectLinking.getTargetSlot(), parentPost);
projectLinking.stop();

console.log("link_relation_self_link_smoke: OK");
