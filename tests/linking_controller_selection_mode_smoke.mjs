import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { LinkingController } from "../js/links/LinkingController.js";

// Targets live in one global slot. There is no keyboard/modal confirmation and
// a second press on a linked source removes exactly that relation.
const documentListeners = new Map();
globalThis.document = {
  addEventListener(name, listener) { documentListeners.set(name, listener); },
  removeEventListener(name, listener) {
    if (documentListeners.get(name) === listener) documentListeners.delete(name);
  }
};

const events = new EventBus();
const slotStates = [];
const obsoleteSelectionStates = [];
events.on("links:target-slot-changed", state => slotStates.push(state));
events.on("links:selection-mode-changed", state => obsoleteSelectionStates.push(state));

const nodes = new Map([
  ["inline-source", { id: "inline-source", props: { text: "Читайте продолжение" } }],
  ["button-source", { id: "button-source", props: { text: "Открыть", url: "" } }]
]);
const updates = [];
const controller = {
  updateNodeProperty(nodeId, property, value) {
    nodes.get(nodeId).props[property] = value;
    updates.push({ kind: "property", nodeId, property, value });
  },
  updateNodeProperties(nodeId, values) {
    Object.assign(nodes.get(nodeId).props, values);
    updates.push({ kind: "properties", nodeId, values });
  }
};

const rows = new Map();
let nextId = 0;
const linkRelations = {
  async create({ source, target, label }) {
    const relation = {
      id: `relation_${++nextId}`,
      source,
      target,
      label,
      resolvedUrl: target.id === "published" ? "https://t.me/example/17" : "",
      createdAt: nextId,
      updatedAt: nextId
    };
    rows.set(relation.id, structuredClone(relation));
    events.emit("links:changed", { reason: "created", relation });
    return relation;
  },
  async get(id) { return rows.get(id) || null; },
  async list() { return [...rows.values()].map(value => structuredClone(value)); },
  async remove(id) {
    const relation = rows.get(id) || null;
    rows.delete(id);
    events.emit("links:changed", { reason: "removed", id, relation });
    return relation;
  }
};

const linking = new LinkingController({
  events,
  tree: { find: id => nodes.get(id) || null },
  controller,
  linkRelations
}).start();

assert.equal(documentListeners.has("keydown"), false, "the slot flow must not install the obsolete Alt+L handler");

const draft = { kind: "draft", id: "draft_1", title: "Черновик" };
const publication = { kind: "publication", id: "published", title: "Опубликованный пост" };

// A target card toggles the slot without a preceding text-selection action.
events.emit("links:target-selected", draft);
assert.deepEqual(slotStates.at(-1).target, draft);
assert.equal(slotStates.at(-1).active, true);

events.emit("links:target-selected", draft);
assert.equal(slotStates.at(-1).target, null, "a second click on the same target clears the slot");
assert.equal(slotStates.at(-1).active, false);

events.emit("links:target-selected", draft);
events.emit("links:target-selected", publication);
assert.deepEqual(slotStates.at(-1).target, publication, "a different target replaces the previous slot value");

// Opening a green target card is navigation, never a target selection. It
// also clears any old yellow slot so the opened source cannot accidentally be
// linked to a stale target.
events.emit("links:open-linked-source-requested", publication);
assert.equal(slotStates.at(-1).target, null, "opening a linked source clears the target slot");

events.emit("links:target-selected", publication);

// Toolbar linking creates the relation immediately and consumes the target slot.
events.emit("links:select-target-requested", {
  source: { nodeId: "inline-source", property: "text", start: 8, end: 19, text: "продолжение" }
});
await tick();
assert.equal(rows.size, 1);
assert.equal(slotStates.at(-1).target, null, "a successful link consumes the slot");
const marker = nodes.get("inline-source").props.text[1];
assert.equal(marker.type, "link_relation");
assert.equal(marker.text, "продолжение");
assert.equal(marker.url, "https://t.me/example/17");
assert.equal(marker.target_title, "Опубликованный пост");

// Pressing the same source button again unwraps the marker and removes it from
// the persistent relation store.
events.emit("links:select-target-requested", {
  source: { nodeId: "inline-source", property: "text", start: 8, end: 19, text: "продолжение" }
});
await tick();
assert.equal(rows.size, 0);
assert.equal(nodes.get("inline-source").props.text, "Читайте продолжение");

// Text Link and URL Button use the same slot. A pending target is represented
// in the inspector by a durable internal URL, never by an empty field.
events.emit("links:target-selected", draft);
events.emit("links:block-target-requested", { nodeId: "button-source", text: "Открыть" });
await tick();
assert.equal(rows.size, 1);
assert.equal(nodes.get("button-source").props.relationId, "relation_2");
assert.equal(nodes.get("button-source").props.url, "rmb-link:relation_2");
assert.equal(slotStates.at(-1).target, null);

events.emit("links:block-target-requested", { nodeId: "button-source", text: "Открыть" });
await tick();
assert.equal(rows.size, 0);
assert.equal(nodes.get("button-source").props.relationId, "");
assert.equal(nodes.get("button-source").props.url, "");

assert.equal(obsoleteSelectionStates.length, 0, "the old pending-selection UI event must not be emitted");
assert(updates.length >= 4);
linking.stop();
console.log("linking_controller_target_slot_smoke: OK");

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}
