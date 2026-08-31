import assert from "node:assert/strict";
import {
  mergeSelectedTableCells,
  tableSelectionMergeMode,
  unmergeTableCell
} from "../js/editor/BlockInspector.js?v=1.5.9";
import { richTextToPlain } from "../js/core/RichText.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";

const table = [
  [{ text: "A" }, { text: "B" }, { text: "C" }],
  [{ text: "D" }, { text: "E" }, { text: "F" }]
];

assert.equal(tableSelectionMergeMode([{ row: 0, col: 0 }, { row: 0, col: 1 }]), "row");
assert.equal(tableSelectionMergeMode([{ row: 0, col: 1 }, { row: 1, col: 1 }]), "column");
assert.equal(tableSelectionMergeMode([{ row: 0, col: 0 }, { row: 1, col: 1 }]), null);
assert.equal(tableSelectionMergeMode([{ row: 0, col: 0 }, { row: 0, col: 2 }]), null, "non-contiguous cells cannot merge");

let merged = mergeSelectedTableCells(table, [{ row: 0, col: 0 }, { row: 0, col: 1 }], "row");
assert.equal(merged.cells[0][0].colspan, 2);
assert.equal(richTextToPlain(merged.cells[0][0].text), "A\nB");
assert.deepEqual(merged.cells[0][1]._mergedInto, { row: 0, col: 0 });
assert.equal(table[0][0].colspan, undefined, "merge must not mutate its input");

let restored = unmergeTableCell(merged.cells, 0, 0);
assert.equal(restored[0][0].colspan, 1);
assert.equal(restored[0][1]._mergedInto, undefined);

merged = mergeSelectedTableCells(table, [{ row: 0, col: 2 }, { row: 1, col: 2 }], "column");
assert.equal(merged.cells[0][2].rowspan, 2);
assert.deepEqual(merged.cells[1][2]._mergedInto, { row: 0, col: 2 });

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);
const renderer = new TelegramRenderer(registry);
const rendered = renderer.render({ root: { children: [{ type: "table", props: { cells: merged.cells }, children: [] }] } });
assert.equal(rendered.blocks[0].cells[0][2].rowspan, 2);
assert.equal(rendered.blocks[0].cells[1].length, 2, "covered vertical cell must not be emitted to Telegram");
assert.equal("_mergedInto" in rendered.blocks[0].cells[1][0], false);

console.log("table_multiselect_merge_smoke: OK");
