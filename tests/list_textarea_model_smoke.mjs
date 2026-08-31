import assert from "node:assert/strict";
import { formatListMarker, markerTypeForCheckboxMode, reconcileListItemsByLines } from "../js/editor/BlockInspector.js?v=1.7.5";

const item = (text, checked) => ({
  blocks: [{ type: "paragraph", text }],
  has_checkbox: true,
  is_checked: checked
});

let items = [item("A", false), item("B", true), item("C", false)];

// Editing text in-place keeps that item's checked state.
items = reconcileListItemsByLines(items, ["A", "B edited", "C"], { checkboxMode: true });
assert.deepEqual(items.map(x => !!x.is_checked), [false, true, false]);
assert.deepEqual(items.map(x => x.blocks[0].text), ["A", "B edited", "C"]);

// Inserting a new logical textarea line must not shift checked states of unchanged items.
items = reconcileListItemsByLines(items, ["A", "new", "B edited", "C"], { checkboxMode: true });
assert.deepEqual(items.map(x => !!x.is_checked), [false, false, true, false]);

// Removing that line restores the original item/state sequence.
items = reconcileListItemsByLines(items, ["A", "B edited", "C"], { checkboxMode: true });
assert.deepEqual(items.map(x => !!x.is_checked), [false, true, false]);

// Marker numbering remains derived from logical textarea-line order.
items = reconcileListItemsByLines(items, ["A", "B edited", "C"], {
  checkboxMode: true,
  markerType: "1",
  start: 4
});
assert.deepEqual(items.map(x => x.value), [4, 5, 6]);
assert.deepEqual(items.map(x => x.type), ["1", "1", "1"]);

// Disabling checkbox mode removes Telegram checkbox fields without changing text.
items = reconcileListItemsByLines(items, ["A", "B edited", "C"], { checkboxMode: false });
assert.ok(items.every(x => !("has_checkbox" in x) && !("is_checked" in x)));
assert.deepEqual(items.map(x => x.blocks[0].text), ["A", "B edited", "C"]);

console.log("list_textarea_model_smoke: OK");

// The same left rail can render the selected Telegram numbering style.
assert.equal(formatListMarker("1", 4), "4.");
assert.equal(formatListMarker("a", 1), "a.");
assert.equal(formatListMarker("a", 27), "aa.");
assert.equal(formatListMarker("A", 28), "AB.");
assert.equal(formatListMarker("i", 9), "ix.");
assert.equal(formatListMarker("I", 14), "XIV.");

assert.equal(markerTypeForCheckboxMode("1", true), "", "checkbox mode must clear an existing numbering marker");
assert.equal(markerTypeForCheckboxMode("A", false), "A");
