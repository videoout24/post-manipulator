import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { BlockInspector } from "../js/editor/BlockInspector.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

const events = new EventBus();
const inspector = new BlockInspector({ events, registry: {}, controller: {} });
const value = ["До ", { type: "link_relation", relation_id: "link_1", text: "связанный текст" }, " после"];
const calls = [];
const textarea = {
  isConnected: true,
  focus() { calls.push("focus"); },
  setSelectionRange(start, end) { calls.push(["range", start, end]); },
  closest() { return null; }
};
const messages = [];
inspector.richTextStates.set("source_node\u0000text", {
  node: { id: "source_node" },
  schema: { key: "text" },
  textarea,
  getCurrent: () => value,
  setStatusMessage: message => messages.push(message),
  toolbarHost: null
});

assert.equal(inspector.focusLinkedRelation({
  id: "link_1",
  source: { kind: "draft", id: "draft_1", nodeId: "source_node", property: "text", mode: "inline" }
}), true);
assert.deepEqual(calls, ["focus", ["range", 3, 18]]);
assert.deepEqual(messages, [t("editor.blockInspector.linkSelectedPressToBreak")]);

console.log("link_relation_source_focus_smoke: OK");
