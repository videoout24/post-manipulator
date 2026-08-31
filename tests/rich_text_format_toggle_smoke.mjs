import assert from "node:assert/strict";
import {
  richTextToPlain,
  richTextRangeHasFormat,
  richTextFormatAtPosition,
  richTextFormatMetadataAtPosition,
  applyRichTextFormat,
  removeRichTextFormat,
  replaceRichTextRange,
  sliceRichText,
  toggleRichTextFormat,
  wrapRichTextWithFormats
} from "../js/core/RichText.js?v=1.5.9";

const bold = { id: "bold", telegramType: "bold", wrapperField: "text" };
const italic = { id: "italic", telegramType: "italic", wrapperField: "text" };

const original = ["a", { type: "bold", text: ["bc", { type: "italic", text: "d" }] }, "e"];
assert.equal(richTextToPlain(original), "abcde");
assert.equal(richTextRangeHasFormat(original, 1, 4, bold), true);
assert.equal(richTextRangeHasFormat(original, 0, 4, bold), false);
assert.equal(richTextFormatAtPosition(original, 3, bold), true);

const unbolded = toggleRichTextFormat(original, 1, 4, bold);
assert.equal(richTextToPlain(unbolded), "abcde");
assert.equal(richTextRangeHasFormat(unbolded, 1, 4, bold), false);
assert.equal(richTextRangeHasFormat(unbolded, 3, 4, italic), true, "nested italic must survive removing bold");

const rebolded = toggleRichTextFormat(unbolded, 0, 4, bold);
assert.equal(richTextRangeHasFormat(rebolded, 0, 4, bold), true, "partial/mixed selection becomes uniformly bold");
assert.equal(richTextRangeHasFormat(rebolded, 3, 4, italic), true, "other wrappers survive applying bold");

const inherited = wrapRichTextWithFormats("typed", [bold, italic]);
assert.equal(richTextToPlain(inherited), "typed");
assert.equal(richTextRangeHasFormat(inherited, 0, 5, bold), true);
assert.equal(richTextRangeHasFormat(inherited, 0, 5, italic), true);

const dateTime = { id: "date_time", telegramType: "date_time", wrapperField: "text", replaceExisting: true };
const timestamped = applyRichTextFormat("soon", 0, 4, dateTime, { unix_time: 1_800_000_000, date_time_format: "" });
assert.deepEqual(timestamped, {
  type: "date_time", text: "soon", unix_time: 1_800_000_000, date_time_format: ""
});
assert.deepEqual(richTextFormatMetadataAtPosition(timestamped, 2, dateTime), {
  unix_time: 1_800_000_000, date_time_format: ""
});
const retimestamped = applyRichTextFormat(removeRichTextFormat(timestamped, dateTime), 0, 4, dateTime, {
  unix_time: 1_900_000_000, date_time_format: "DT"
});
assert.deepEqual(retimestamped, {
  type: "date_time", text: "soon", unix_time: 1_900_000_000, date_time_format: "DT"
}, "reconfiguring a timestamp must replace its metadata instead of nesting date_time wrappers");

const twoTimestamps = [
  { type: "date_time", text: "first", unix_time: 1_700_000_000, date_time_format: "" },
  " ",
  { type: "date_time", text: "second", unix_time: 1_800_000_000, date_time_format: "" }
];
const selectedTimestamp = sliceRichText(twoTimestamps, 6, 12);
const updatedTimestamp = applyRichTextFormat(removeRichTextFormat(selectedTimestamp, dateTime), 0, 6, dateTime, {
  unix_time: 1_900_000_000, date_time_format: "d"
});
const scopedUpdate = replaceRichTextRange(twoTimestamps, 6, 12, updatedTimestamp);
assert.deepEqual(scopedUpdate, [
  { type: "date_time", text: "first", unix_time: 1_700_000_000, date_time_format: "" },
  " ",
  { type: "date_time", text: "second", unix_time: 1_900_000_000, date_time_format: "d" }
], "updating one timestamp must not alter another timestamp in the same RichText field");

console.log("rich_text_format_toggle_smoke: OK");
