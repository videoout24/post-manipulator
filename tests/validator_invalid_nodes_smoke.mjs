import assert from "node:assert/strict";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { Validator } from "../js/core/Validator.js?v=1.5.9";
import fs from "node:fs";

const properties = createDefaultPropertyRegistry(createTelegramFormattingRegistry());
const registry = new BlockRegistry(properties);
registerTelegramCore(registry);
const tree = new BlockTree({
  id: "root", type: "document", props: {}, children: [
    { id: "empty", type: "paragraph", props: { text: "" }, children: [] },
    { id: "anchor-a", type: "anchor", props: { name: "same" }, children: [] },
    { id: "anchor-b", type: "anchor", props: { name: "same" }, children: [] },
    { id: "broken-link", type: "anchor_link", props: { text: "link", targetAnchorId: "missing" }, children: [] },
    {
      id: "mixed-list", type: "list", props: { items: [
        { blocks: [{ type: "paragraph", text: "Unordered" }] },
        { blocks: [{ type: "paragraph", text: "Ordered" }], type: "1", value: 2 }
      ] }, children: []
    },
    { id: "ok", type: "paragraph", props: { text: "valid" }, children: [] }
  ]
});

const invalid = new Validator(registry).invalidNodeIds(tree);
assert.deepEqual([...invalid].sort(), ["anchor-a", "anchor-b", "broken-link", "empty", "mixed-list"]);

const coordinator = fs.readFileSync(new URL("../js/editor/EditorEventCoordinator.js", import.meta.url), "utf8");
assert.match(coordinator, /payload\?\.source === "property"[\s\S]*?workspace\?\.updateValidation\?\.\(\)/);

console.log("validator_invalid_nodes_smoke: OK");
