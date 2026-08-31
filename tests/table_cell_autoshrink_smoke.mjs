import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const sizing = fs.readFileSync(new URL("../js/editor/SessionTextareaSizing.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(inspector, /const minimumWidth = measureLine\("000000"\);/, "Table columns must keep a measured compact minimum width");
assert.match(inspector, /measureContext\.measureText\(String\(line\)\)\.width/, "Column width must use real font metrics instead of character count");
assert.match(inspector, /Math\.ceil\(max \+ horizontalChrome\) \+ 1/, "Measured text must include element chrome and a rounding pixel");
assert.match(inspector, /gridTemplateColumns = columnWidths\.map\(width => `\$\{width\}px`\)/, "Measured column widths must be applied in pixels");
assert.ok((inspector.match(/autoShrink: true/g) || []).length >= 2, "Table attach and refresh paths must both auto-shrink");
assert.match(sizing, /const rows = autoShrink \? Math\.max\(contentRows, minRows\)/);
assert.match(css, /\.table-cell-text\.session-autosize-textarea\s*\{\s*resize:\s*none !important;/);

console.log("table_cell_autoshrink_smoke: OK");
