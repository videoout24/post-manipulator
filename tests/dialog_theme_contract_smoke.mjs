import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [css, dialogs, gallery, settings, metaDialog] = await Promise.all([
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../js/core/DarkDialog.js", import.meta.url), "utf8"),
  readFile(new URL("../js/gallery/GalleryView.js", import.meta.url), "utf8"),
  readFile(new URL("../js/telegram/TelegramSettingsView.js", import.meta.url), "utf8"),
  readFile(new URL("../js/editor/MetaBlockDialog.js", import.meta.url), "utf8")
]);

assert.match(css, /dialog \{[\s\S]*?color-scheme: dark;[\s\S]*?background: #10161e;[\s\S]*?color: #e9eef5;/);
assert.match(css, /dialog::backdrop \{ background: rgba\(0, 0, 0, \.72\); \}/);
assert.match(css, /dialog input,[\s\S]*?dialog select,[\s\S]*?dialog textarea \{[\s\S]*?background: #0b1118;[\s\S]*?color: #e9eef5;/);
assert.match(css, /#securityGate \{[\s\S]*?color: #e9eef5;/);
assert.match(css, /\.security-gate-card \{[\s\S]*?border: 1px solid #334357;[\s\S]*?background: #141d28;/);
assert.match(css, /\.security-gate-copy \{ margin: 0; color: #a6b4c5;/);
assert.doesNotMatch(css, /security-gate-card[\s\S]*?tg-theme-secondary-bg-color/);
assert.match(css, /\.app-modal-dialog \{ width: min\(420px, calc\(100vw - 28px\)\); \}/);
assert.match(dialogs, /requestTextDialog/);
assert.match(dialogs, /confirmDarkDialog/);
assert.match(gallery, /requestTextDialog/);
assert.match(settings, /confirmDarkDialog/);
assert.match(metaDialog, /showDarkMessage/);
assert.doesNotMatch(gallery, /\b(prompt|confirm)\s*\(/);
assert.doesNotMatch(settings, /\bconfirm\s*\(/);
assert.doesNotMatch(metaDialog, /\balert\s*\(/);

console.log("dialog_theme_contract_smoke: OK");
