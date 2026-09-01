import assert from "node:assert/strict";
import fs from "node:fs";
import { AVAILABLE_EMOJIS } from "../js/editor/EmojiCatalog.js";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.ok(AVAILABLE_EMOJIS.length >= 1_000,
  "picker must expose a comprehensive catalog, including skin tones and country flags");
assert.equal(new Set(AVAILABLE_EMOJIS).size, AVAILABLE_EMOJIS.length,
  "emoji catalog must not contain duplicate buttons");
for (const emoji of ["😀", "🫶", "🧑‍💻", "🐦‍🔥", "🍕", "🚀", "📌", "✅", "🇺🇦", "🏴‍☠️", "👍🏿"]) {
  assert.ok(AVAILABLE_EMOJIS.includes(emoji), `emoji catalog must include ${emoji}`);
}
assert.match(inspector,
  /host\.append\(link\);[\s\S]*if \(formats\.includes\("date_time"\)\) appendFormatButton\("date_time"\);[\s\S]*host\.append\(emoji\);[\s\S]*this\.refreshRichTextToolbarState/,
  "time and emoji must be the final toolbar controls, in that order");
assert.doesNotMatch(inspector, /appendFormatButton\("custom_emoji"\)/,
  "the manual custom emoji ID control must not be exposed");
assert.match(css, /\.basic-emoji-picker\s*\{[^}]*height:\s*147px;[^}]*overflow-y:\s*auto;/s,
  "emoji picker must be four 30px rows high and scrollable");
assert.match(css, /\.basic-emoji-picker\s*\{[^}]*scrollbar-width:\s*none;/s,
  "emoji picker scrollbar must not consume a grid column");
assert.match(css, /\.basic-emoji-picker::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/s,
  "emoji picker scrollbar must be hidden in WebKit browsers");

assert.match(inspector, /if \(!event\.ctrlKey\) \{\s*state\.insertValue\?\.\(value\);\s*return;/s,
  "emoji click must insert without closing the picker");
assert.match(inspector, /event\.preventDefault\(\);\s*picker\.prepend\(button\);\s*picker\.scrollTop = 0;/s,
  "Ctrl+click must move an emoji to the beginning without inserting it");
assert.match(inspector, /emojiPreferences\?\.promote\?\.\(value\)/,
  "promoted emoji order must be persisted");
assert.match(inspector, /inputType\.startsWith\("insert"\)\) this\.closeEmojiPicker\(state\)/,
  "typing/paste insertion must close the picker");
assert.match(inspector, /event\.key !== "Escape"/,
  "Escape must close the picker");
assert.match(inspector, /if \(host\.querySelector\("\.basic-emoji-picker"\)\) \{\s*this\.closeEmojiPicker\(state, \{ focus: true \}\);/s,
  "re-clicking Emoji button must toggle the picker closed");
assert.match(inspector, /aria-expanded/,
  "Emoji toolbar button must expose open/closed state");

console.log("emoji_picker_persistence_smoke: OK");
