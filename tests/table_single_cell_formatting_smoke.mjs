import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");

assert.match(inspector, /shouldApplyFormatBatch: \(\) => selectedCells\.size > 1/);
assert.match(inspector, /textarea\.selectionStart[\s\S]*?=== \(textarea\.selectionEnd/);
assert.match(inspector, /state\.applyFormatBatch && state\.shouldApplyFormatBatch\?\.\(\) !== false/);
assert.match(inspector, /toggleRichTextFormat\(current, 0, length, format, metadata\)/);
assert.match(inspector, /applyRichTextFormatValue\(current, targetStart, targetEnd, format, metadata\)/);
assert.match(inspector, /toggleRichTextFormat\(selected, 0, richTextLength\(selected\), format, metadata\)/);

console.log("table single-cell formatting smoke: OK");
