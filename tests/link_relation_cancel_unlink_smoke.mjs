import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { LinkingController } from "../js/links/LinkingController.js";

// Cancelling unlink is a true no-op.  In particular, the source must not be
// unwrapped/cleared before the confirmation result is known.
const events = new EventBus();
const nodes = new Map([
  ["inline-source", {
    id: "inline-source",
    props: {
      text: [
        "До ",
        {
          type: "link_relation",
          relation_id: "inline_relation",
          text: "ссылка",
          url: "rmb-link:inline_relation",
          target_title: "Целевой черновик",
          target_kind: "draft"
        },
        " после"
      ]
    }
  }],
  ["block-source", {
    id: "block-source",
    props: {
      text: "Открыть",
      relationId: "block_relation",
      relationTargetTitle: "Целевой черновик",
      relationTargetKind: "draft",
      url: "rmb-link:block_relation"
    }
  }]
]);

const rows = new Map([
  ["inline_relation", relation("inline_relation", {
    nodeId: "inline-source",
    property: "text",
    mode: "inline"
  })],
  ["block_relation", relation("block_relation", {
    nodeId: "block-source",
    property: "url",
    mode: "block"
  })]
]);
const sourceUnlinked = [];
const removed = [];
const confirmations = [];
const writes = [];
let removeCalls = 0;
events.on("links:source-unlinked", payload => sourceUnlinked.push(payload));
events.on("links:removed", payload => removed.push(payload));

const linking = new LinkingController({
  events,
  tree: { find: id => nodes.get(id) || null },
  controller: {
    updateNodeProperty(nodeId, property, value) {
      nodes.get(nodeId).props[property] = value;
      writes.push({ nodeId, property });
    },
    updateNodeProperties(nodeId, values) {
      Object.assign(nodes.get(nodeId).props, values);
      writes.push({ nodeId, properties: Object.keys(values) });
    }
  },
  linkRelations: {
    async list() { return clone([...rows.values()]); },
    async get(id) { return clone(rows.get(String(id)) || null); },
    async remove(id) {
      removeCalls += 1;
      const value = rows.get(String(id)) || null;
      rows.delete(String(id));
      return clone(value);
    }
  },
  confirmFn(message) {
    confirmations.push(message);
    return false;
  }
}).start();

await tick();
const nodesBefore = clone([...nodes.entries()]);
const rowsBefore = clone([...rows.entries()]);

// Both source forms already contain a relation, so each action requests
// confirmation.  A cancelled confirmation must preserve both independently.
await linking.attachInline({
  nodeId: "inline-source",
  property: "text",
  start: 3,
  end: 9
});
await linking.attachBlock({ nodeId: "block-source", text: "Открыть" });

assert.equal(confirmations.length, 2, "both unlink attempts must ask for confirmation");
assert.deepEqual([...nodes.entries()], nodesBefore, "cancel must preserve the inline marker and block relation props");
assert.deepEqual([...rows.entries()], rowsBefore, "cancel must preserve both persistent relations");
assert.equal(removeCalls, 0, "cancel must not remove a persistent relation");
assert.deepEqual(writes, [], "cancel must not write either source node");
assert.deepEqual(sourceUnlinked, [], "cancel must not announce source unlinking");
assert.deepEqual(removed, [], "cancel must not announce relation removal");

linking.stop();
console.log("link_relation_cancel_unlink_smoke: OK");

function relation(id, source) {
  return {
    id,
    source: { kind: "draft", id: "draft_source", ...source },
    target: { kind: "draft", id: "draft_target", title: "Целевой черновик" },
    label: "ссылка",
    createdAt: 1,
    updatedAt: 1
  };
}

function clone(value) {
  return structuredClone(value);
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}
