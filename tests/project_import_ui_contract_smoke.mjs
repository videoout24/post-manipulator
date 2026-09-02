import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const library = await readFile(new URL("../js/project/ProjectLibraryView.js", import.meta.url), "utf8");
const store = await readFile(new URL("../js/project/ProjectStore.js", import.meta.url), "utf8");

assert.match(library, /fileInput\.multiple = true/);
assert.match(library, /parseProjectImportText\(await file\.text\(\)/);
assert.match(library, /this\.store\.importProjects\(projects\)/);
assert.match(library, /MAX_PROJECT_IMPORT_FILE_BYTES/);
assert.match(store, /resetImportedPostRuntime/);
assert.match(store, /post\.publication = \{ state: "draft" \}/);
assert.match(store, /reason: "imported"/);

console.log("project import UI contract smoke: OK");
