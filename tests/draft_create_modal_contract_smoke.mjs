import { readStylesSync } from "./read_styles.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";

const commands = fs.readFileSync(new URL("../js/editor/EditorCommandController.js", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../js/app/createEditorShell.js", import.meta.url), "utf8");
const css = readStylesSync();

assert.match(commands, /await this\.requestDraftTitleFn\(\{[\s\S]*?mode: "create"/);
assert.match(commands, /await this\.requestDraftTitleFn\(\{[\s\S]*?mode: "save-copy"/);
assert.match(commands, /dialog\.className = "draft-create-dialog"/);
assert.match(commands, /savingCopy \? t\("editor\.editorCommandController\.saveAsDraft"\) : t\("editor\.editorCommandController\.newDraft"\)/);
assert.match(commands, /dialog\.showModal\(\)/);
assert.match(shell, /promptFn = null/);
assert.match(css, /\.draft-create-dialog/);

console.log("draft create modal contract smoke: ok");
