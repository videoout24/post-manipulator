import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");

assert.match(css, /select:not\(\[multiple\]\)\s*\{[\s\S]*?-webkit-appearance:\s*none;[\s\S]*?appearance:\s*none;/);
assert.match(css, /select:not\(\[multiple\]\)\s*\{[\s\S]*?background-color:\s*#0b1118;[\s\S]*?background-image:/);
assert.match(css, /select:not\(\[multiple\]\) option\s*\{\s*background-color:\s*#0b1118;\s*color:\s*#d8e2ee;/);
assert.match(css, /\.date-time-picker\.has-accessory\s*\{[\s\S]*?minmax\(128px,\s*180px\)/);
assert.match(css, /\.date-time-picker-format\s*\{[\s\S]*?height:\s*28px;/);
assert.match(css, /\.asset-picker-topic\s*\{\s*height:\s*30px;/);
assert.match(inspector, /marker\.disabled = !!schema\.readOnly \|\| checkboxMode/);
assert.match(inspector, /markerType = markerTypeForCheckboxMode\(markerType, checkboxMode\);[\s\S]*?marker\.value = markerType/);

console.log("editor_select_theme_contract_smoke: OK");
