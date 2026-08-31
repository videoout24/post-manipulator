import assert from "node:assert/strict";
import fs from "node:fs";

const blocks = fs.readFileSync(new URL("../js/blocks/registerCoreBlocks.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(blocks, /type: "heading"[\s\S]*?rich\("content\.text", "text", FORMAT_GROUPS\.full/);
assert.match(blocks, /type: "footer"[\s\S]*?rich\("content\.text", "text", FORMAT_GROUPS\.full/);
assert.match(blocks, /type:"details"[\s\S]*?rich\("details\.summary", "summary", FORMAT_GROUPS\.full/);
assert.deepEqual(
  [...blocks.matchAll(/FORMAT_GROUPS\.(basic|heading|code)/g)].map(match => match[1]),
  ["code"],
  "Only Preformatted may intentionally restrict the standard RichText toolbar"
);
assert.match(css, /\.rich-text-editor textarea\s*\{[^}]*background:\s*#0c1117;[^}]*color:\s*inherit;/);

console.log("rich_text_block_styles_smoke: OK");
