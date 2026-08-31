import assert from "node:assert/strict";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { migrateDocumentTree } from "../js/core/DocumentMigrations.js?v=1.5.9";

const tree = new BlockTree({
  id: "root",
  type: "document",
  props: {},
  children: [
    { id: "photo", type: "photo", props: { url: "telegram-file" }, children: [] },
    {
      id: "list",
      type: "list",
      props: { ordered: true },
      children: [
        { id: "paragraph", type: "paragraph", props: { text: "Первый" }, children: [] },
        { id: "caption", type: "photo", props: { caption: "Второй" }, children: [] }
      ]
    },
    {
      id: "quote",
      type: "block_quotation",
      props: {},
      children: [
        { id: "q1", type: "paragraph", props: { text: "Строка 1" }, children: [] },
        { id: "q2", type: "paragraph", props: { text: "Строка 2" }, children: [] }
      ]
    }
  ]
});

assert.equal(migrateDocumentTree(tree), tree, "migration must preserve the BlockTree identity");
assert.equal(tree.find("photo").props.fileId, "telegram-file");

const list = tree.find("list");
assert.deepEqual(list.children, []);
assert.deepEqual(list.props.items, [
  { blocks: [{ type: "paragraph", text: "Первый" }], type: "1", value: 1 },
  { blocks: [{ type: "paragraph", text: "Второй" }], type: "1", value: 2 }
]);
assert(!("ordered" in list.props));

const quote = tree.find("quote");
assert.equal(quote.props.text, "Строка 1\nСтрока 2");
assert.deepEqual(quote.children, []);

console.log("document_migrations_smoke: OK");
