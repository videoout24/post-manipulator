import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(css, /\.canvas\s*\{[\s\S]*?--canvas-font-size:\s*10px;/);
assert.match(css, /\.block-preview\s*\{[^}]*font-size:\s*var\(--canvas-font-size\)/);
for (const property of ["content.caption", "content.captionCredit", "content.credit", "details.summary"]) {
  assert.match(css, new RegExp(`data-property=["']${property.replace('.', '\\.')}`));
}

console.log("editor_canvas_typography_smoke: OK");
