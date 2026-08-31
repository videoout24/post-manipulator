import assert from "node:assert/strict";
import fs from "node:fs";
import { listAnchors } from "../js/core/SemanticRichText.js?v=1.5.9";

const properties = fs.readFileSync(new URL("../js/core/PropertyRegistry.js", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../js/editor/BlockPalette.js", import.meta.url), "utf8");
const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");

const nodes = [
  { id: "anchor_a", type: "anchor", props: { name: "chapter-a" }, children: [] },
  { id: "paragraph", type: "paragraph", props: { text: "Text" }, children: [] },
  { id: "anchor_b", type: "anchor", props: { name: "chapter-b" }, children: [] }
];
const tree = { walk(visitor) { for (const node of nodes) visitor(node); } };
assert.deepEqual(listAnchors(tree).map(anchor => anchor.id), ["anchor_a", "anchor_b"]);
assert.match(properties, /add\("anchor\.target",\s*\{[\s\S]*?editor:\s*"anchor-select"/);
assert.match(palette, /for \(const anchor of listAnchors\(this\.controller\.tree\)\)/);
assert.match(inspector, /const anchors = listAnchors\(this\.controller\.tree\)/);

console.log("anchor_link_navigation_contract_smoke: OK");
