import assert from "node:assert/strict";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";

const registry = { get() { return {}; } };
const renderer = new TelegramRenderer(registry);
const tree = {
  root: {
    id: "root",
    type: "document",
    props: {},
    children: [{
      id: "list-1",
      type: "list",
      props: {
        items: [
          { blocks: [{ type: "paragraph", text: "one" }], has_checkbox: true, is_checked: false },
          { blocks: [{ type: "paragraph", text: "two" }], has_checkbox: true, is_checked: true },
          { blocks: [{ type: "paragraph", text: "three" }], has_checkbox: true, is_checked: false }
        ]
      },
      children: []
    }]
  },
  walk(fn) {
    const visit = node => { fn(node); for (const child of node.children || []) visit(child); };
    visit(this.root);
  }
};

const rendered = renderer.render(tree);
const items = rendered.blocks[0].items;
assert.equal(items.length, 3);
assert.deepEqual(items.map(item => item.has_checkbox), [true, true, true]);
assert.deepEqual(items.map(item => !!item.is_checked), [false, true, false]);
assert.equal(items[0].blocks[0].text, "one");
assert.equal(items[1].blocks[0].text, "two");
assert.equal(items[2].blocks[0].text, "three");
console.log("list_checkbox_smoke: OK");
