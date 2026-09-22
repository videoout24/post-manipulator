import assert from "node:assert/strict";
import fs from "node:fs";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { Validator } from "../js/core/Validator.js?v=1.5.9";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";

const properties = createDefaultPropertyRegistry(createTelegramFormattingRegistry());
const registry = new BlockRegistry(properties);
registerTelegramCore(registry);
assert.equal(registry.get("visibility_group").aiPrompt, false);
const renderer = new TelegramRenderer(registry);
const validator = new Validator(registry);

const tree = new BlockTree({
  id: "root", type: "document", props: {}, children: [
    { id: "before", type: "paragraph", props: { text: "Before" }, children: [] },
    { id: "outer", type: "visibility_group", props: { title: "Optional", included: true }, children: [
      { id: "visible", type: "paragraph", props: { text: "Visible" }, children: [] },
      { id: "inner", type: "visibility_group", props: { title: "Draft", included: false }, children: [
        { id: "invalid", type: "heading", props: { text: "" }, children: [] },
        { id: "hidden", type: "paragraph", props: { text: "Hidden" }, children: [] }
      ] }
    ] },
    { id: "after", type: "paragraph", props: { text: "After" }, children: [] }
  ]
});

assert.deepEqual(
  renderer.render(tree).blocks.map(block => block.text),
  ["Before", "Visible", "After"],
  "included groups must flatten in place and hidden nested groups must render nothing"
);
assert.deepEqual(validator.validate(tree), [], "invalid hidden descendants must not block publication");
assert.equal(validator.invalidNodeIds(tree).has("invalid"), true,
  "hidden descendants must remain locally validated on Canvas");

tree.find("outer").props.included = false;
assert.deepEqual(renderer.render(tree).blocks.map(block => block.text), ["Before", "After"],
  "hiding an outer group must exclude its whole branch");

const hiddenOnly = new BlockTree({
  id: "root", type: "document", props: {}, children: [
    { id: "group", type: "visibility_group", props: { included: false }, children: [
      { id: "paragraph", type: "paragraph", props: { text: "Saved" }, children: [] }
    ] }
  ]
});
assert.match(validator.validate(hiddenOnly).join("\n"), /requires at least 1 block/,
  "a document containing only hidden content must not be publishable");

const treeView = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../styles/editor.css", import.meta.url), "utf8");
assert.match(treeView, /makeVisibilityGroupToggle\(node\)/);
assert.match(treeView, /updateNodeProperty\(node\.id, "included", !included\)/);
assert.match(treeView, /if \(def\?\.aiPrompt !== false\) el\.append\(this\.makeAiPromptEditor\(node\)\)/);
assert.match(styles, /\.block\.visibility-group-hidden[\s\S]*?border-style:\s*dashed/);

console.log("visibility_group_smoke: OK");
