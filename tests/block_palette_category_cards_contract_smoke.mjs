import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../js/editor/BlockPalette.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
const blocks = fs.readFileSync(new URL("../js/blocks/registerCoreBlocks.js", import.meta.url), "utf8");

assert.match(html, /id="blockSearch"[\s\S]*id="blockCategoryFilters"/);
assert.match(palette, /this\.category = "all"/);
assert.match(palette, /renderCategoryFilters\(available\)/);
assert.match(palette, /palette-category-chip/);
assert.match(palette, /palette-meta-delete/);
assert.match(palette, /this\.metaRegistry\.remove\(definition\.type\)/);
assert.match(palette, /const name = document\.createElement\("strong"\)/);
assert.match(palette, /const type = document\.createElement\("span"\)/);
assert.match(palette, /if \(category === t\("blocks\.category\.content"\)\) blocks\.sort\(compareContentBlocks\)/);
assert.match(palette, /type === "heading" \? 0 : type === "paragraph" \? 1 : type === "footer" \? 3 : 2/);
assert.match(css, /\.palette-category-filters\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
assert.match(css, /\.palette-scroll \.palette-item\s*\{/);
assert.doesNotMatch(blocks, /category:\s*"Layout"/);
for (const type of ["divider", "table", "details"]) {
  assert.match(blocks, new RegExp(`type:\\s*"${type}"[\\s\\S]{0,140}category:\\s*t\\("blocks\\.category\\.content"\\)`));
}
assert.match(blocks, /semantic\("anchor_link", t\("blocks\.registerCoreBlocks\.anchorLink"\),[\s\S]*?\{ category: t\("blocks\.registerCoreBlocks\.navigation"\) \}\)/);
assert.match(blocks, /type:\s*"button_row", name:\s*t\("blocks\.registerCoreBlocks\.buttonRow"\)/);
assert.match(blocks, /children:\s*\{ allowed: true, types: \["url_button"\], minItems: 1, maxItems: 8 \}/);
assert.match(blocks, /type:\s*"url_button", name:\s*t\("blocks\.registerCoreBlocks\.urlButton"\), category:\s*t\("blocks\.registerCoreBlocks\.semantics"\)/);
assert.match(blocks, /type:\s*"thinking", name:\s*t\("blocks\.registerCoreBlocks\.thinking"\), paletteHidden:true, category:\s*t\("blocks\.category\.system"\)/,
  "Thinking must stay compatible with old documents without appearing in the block palette");

console.log("block_palette_category_cards_contract_smoke: OK");
