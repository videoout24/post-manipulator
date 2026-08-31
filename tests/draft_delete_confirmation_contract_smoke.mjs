import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync(new URL("../js/editor/EditorRightPanel.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

const list = fs.readFileSync(new URL("../js/editor/DraftListView.js", import.meta.url), "utf8");
assert.match(list, /showCardDeleteConfirmation/);
assert.match(list, /Удалить «\$\{draft/);
assert.match(list, /project-post-card-overlay project-post-rename-editor/);
assert.match(list, /showRenameEditor\(card, draft, onRename\)/);
assert.doesNotMatch(panel, /confirm\(`Удалить черновик/);
assert.doesNotMatch(panel, /prompt\("Название черновика"/);
assert.match(css, /\.draft-card\s*\{[^}]*position:\s*relative;/s);
assert.match(css, /\.draft-project-select-field select\s*\{[^}]*background:\s*#080b0f;/s);
assert.match(css, /\.draft-project-select-field select option\s*\{[^}]*background:\s*#080b0f;/s);

console.log("draft_delete_confirmation_contract_smoke: OK");
