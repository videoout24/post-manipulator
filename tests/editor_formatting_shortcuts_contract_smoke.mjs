import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const sizing = fs.readFileSync(new URL("../js/editor/SessionTextareaSizing.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(sizing, /Alt\+↑ — ниже на строку; Alt\+↓ — выше на строку/);
assert.match(sizing, /event\.key === "ArrowDown" \? current \+ 1/);
assert.match(inspector, /\["ControlLeft", "ControlRight"\]\.includes\(event\.code\)/);
assert.match(inspector, /tableCtrlKeys\.add\(event\.code\)/);
assert.match(inspector, /L\/R Ctrl \+ ← ↑ → ↓/);
assert.match(inspector, /rich-style-inherit/);
assert.match(inspector, /toggleRichTextFormat/);
assert.match(css, /rich-format-button\.active/);
assert.match(css, /rich-style-inherit/);

console.log("editor_formatting_shortcuts_contract_smoke: OK");
