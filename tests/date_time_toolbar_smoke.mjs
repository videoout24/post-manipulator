import assert from "node:assert/strict";
import fs from "node:fs";
import { createTelegramFormattingRegistry, FORMAT_GROUPS } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { dateTimeFormatMetadata, dateTimeLocalToUnix, unixTimeToDateTimeLocal } from "../js/core/SemanticRichText.js?v=1.5.9";

const dateTime = createTelegramFormattingRegistry().get("date_time");
assert.equal(dateTime.toolbar, true, "date/time must be available in the RichText toolbar");
assert.equal(dateTime.metadataEditor, "date-time");
assert.equal(dateTime.inheritMetadata, true, "typing inheritance must preserve a timestamp");
assert.equal(dateTime.replaceExisting, true, "reapplying a timestamp updates metadata without nested wrappers");
assert.ok(FORMAT_GROUPS.full.includes("date_time"));

const local = "2030-04-05T06:07";
const metadata = dateTimeFormatMetadata({ dateTime: local, date_time_format: "DT" });
assert.equal(metadata.unix_time, dateTimeLocalToUnix(local));
assert.equal(metadata.date_time_format, "DT");
assert.equal(unixTimeToDateTimeLocal(metadata.unix_time), local);

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../js/editor/BlockPalette.js", import.meta.url), "utf8");
const picker = fs.readFileSync(new URL("../js/editor/DateTimePicker.js", import.meta.url), "utf8");
const treeView = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
assert.match(inspector, /format\.metadataEditor === "date-time"/);
assert.match(inspector, /state\.typingSession\.metadata\.set\(format\.id, metadata\)/);
assert.match(inspector, /const selected = sliceRichText\(value, start, end\)/);
assert.match(inspector, /accessory: display/,
  "the display format selector must share the date/time picker row");
assert.match(inspector, /node\?\.type !== "date_time"/);
assert.match(inspector, /renderDateTimeBlockFields/,
  "the standalone Date\/Time block must use the same one-line date and format picker");
assert.match(inspector, /createDateTimePicker/);
assert.match(palette, /createDateTimePicker/);
assert.match(picker, /input\.type = "datetime-local"/);
assert.match(picker, /if \(accessory\) row\.append\(accessory\)/);
assert.doesNotMatch(picker, /date-time-picker-calendar/,
  "the native date/time input already opens the calendar; a duplicate calendar button must not be rendered");
assert.match(picker, /beforeinput/);
assert.match(treeView, /input, textarea, select, button, summary/,
  "the Canvas must keep native property-section disclosure controls interactive");

console.log("date_time_toolbar_smoke: OK");
