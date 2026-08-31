import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");

const buttonIndex = inspector.indexOf("cellControls.append(cellLabel, navHint, mergeRow, mergeColumn, unmerge, applyAlignmentToAll, align.wrap, valign.wrap)");
assert.notEqual(buttonIndex, -1, "Apply-to-all button must precede the alignment selectors");
assert.doesNotMatch(inspector, /compactNumber\("colspan"/);
assert.doesNotMatch(inspector, /compactNumber\("rowspan"/);
assert.match(inspector, /for \(const row of cells\)[\s\S]*?for \(const cell of row\)[\s\S]*?cell\.align = align\.input\.value;[\s\S]*?cell\.valign = valign\.input\.value;[\s\S]*?commit\(\);/);

console.log("table_apply_alignment_all_smoke: OK");
