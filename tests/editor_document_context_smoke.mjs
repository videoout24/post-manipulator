import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { EditorController } from "../js/editor/EditorController.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

const events = new EventBus();
const tree = new BlockTree();
const selection = {
  selected: null,
  primary() { return this.selected; },
  set(id) { this.selected = id; },
  all() { return this.selected ? [this.selected] : []; },
  has(id) { return this.selected === id; }
};
const controller = new EditorController({
  tree,
  registry: { get: type => type === "paragraph" ? { type, properties: {}, children: {} } : null },
  validator: null,
  events,
  selection
});

let request = null;
events.on("editor:draft-create-requested", value => { request = value; });
controller.setDocumentContextResolver(() => false);

assert.equal(controller.addBlock("paragraph"), null);
assert.equal(tree.root.children.length, 0, "a block must not enter a nameless Canvas");
assert.equal(request.type, "paragraph");
assert.equal(controller.mutationError("property"), t("editor.editorController.firstOpenOrCreateADraft"));

controller.setDocumentContextResolver(() => true);
const block = controller.addBlock("paragraph");
assert.equal(block?.type, "paragraph");
assert.equal(tree.root.children.length, 1);

console.log("editor_document_context_smoke: OK");
