import assert from "node:assert/strict";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { MetaBlockRegistry } from "../js/core/MetaBlockRegistry.js?v=1.5.9";

const definitions = new Map();
const blockRegistry = {
  properties: null,
  has: type => definitions.has(type),
  register(definition) { definitions.set(definition.type, structuredClone(definition)); },
  unregister(type) { return definitions.delete(type); }
};
const tree = new BlockTree({
  id: "root", type: "document", props: {}, children: [
    { id: "heading_1", type: "heading", props: { text: [{ type: "bold", text: "Заголовок" }], level: 2 }, children: [] },
    { id: "details_1", type: "details", props: { summary: "Раздел", open: true }, children: [
      { id: "photo_1", type: "photo", props: { galleryId: "asset_1", fileId: "file_1", caption: "Фото" }, children: [] }
    ] }
  ]
});
const meta = new MetaBlockRegistry(blockRegistry, "test-meta-blocks");
const definition = meta.create({
  type: "saved_post",
  name: "Сохранённый пост",
  category: "Custom",
  sourceNodeIds: tree.root.children.map(node => node.id),
  tree,
  parameters: []
});

assert.equal(definition.template.length, 2, "all Canvas root blocks must be captured");
assert.deepEqual(definition.template[0].props, tree.root.children[0].props, "formatted content and settings must be preserved");
assert.deepEqual(definition.template[1].children[0].props, tree.root.children[1].children[0].props, "nested structure and media settings must be preserved");
assert.equal("id" in definition.template[0], false, "template nodes must not reuse Canvas ids");
assert.deepEqual(definition.bindings, []);
assert.equal(meta.remove("saved_post"), true);
assert.equal(definitions.has("saved_post"), false, "removed Meta Block must leave the active registry");

console.log("meta_block_full_canvas_snapshot_smoke: OK");
