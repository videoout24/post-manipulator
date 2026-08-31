import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");

assert.match(inspector, /button\.onclick = \(\) => state\.insertValue\?\.\(value\);/,
  "emoji click must insert without closing the picker");
assert.doesNotMatch(inspector, /button\.onclick = \(\) => \{ state\.insertValue\?\.\(value\); host\.innerHTML = ""; \}/,
  "legacy close-after-each-emoji behavior must be removed");
assert.match(inspector, /inputType\.startsWith\("insert"\)\) this\.closeEmojiPicker\(state\)/,
  "typing/paste insertion must close the picker");
assert.match(inspector, /event\.key !== "Escape"/,
  "Escape must close the picker");
assert.match(inspector, /if \(host\.querySelector\("\.basic-emoji-picker"\)\) \{\s*this\.closeEmojiPicker\(state, \{ focus: true \}\);/s,
  "re-clicking Emoji button must toggle the picker closed");
assert.match(inspector, /aria-expanded/,
  "Emoji toolbar button must expose open/closed state");

console.log("emoji_picker_persistence_smoke: OK");
