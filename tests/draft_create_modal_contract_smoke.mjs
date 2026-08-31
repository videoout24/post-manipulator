import assert from "node:assert/strict";
import fs from "node:fs";

const commands = fs.readFileSync(new URL("../js/editor/EditorCommandController.js", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../js/app/createEditorShell.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(commands, /await this\.requestDraftTitleFn\(\{[\s\S]*?mode: "create"/);
assert.match(commands, /await this\.requestDraftTitleFn\(\{[\s\S]*?mode: "save-copy"/);
assert.match(commands, /dialog\.className = "draft-create-dialog"/);
assert.match(commands, /savingCopy \? "Сохранить как черновик" : "Новый черновик"/);
assert.match(commands, /dialog\.showModal\(\)/);
assert.match(shell, /promptFn = null/);
assert.match(css, /\.draft-create-dialog/);

console.log("draft create modal contract smoke: ok");
