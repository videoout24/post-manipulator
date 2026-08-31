import assert from "node:assert/strict";
import fs from "node:fs";

const confirmation = fs.readFileSync(new URL("../js/core/CardDeleteConfirmation.js", import.meta.url), "utf8");
const canvas = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
const publications = fs.readFileSync(new URL("../js/publications/PublicationView.js", import.meta.url), "utf8");
const library = fs.readFileSync(new URL("../js/project/ProjectLibraryView.js", import.meta.url), "utf8");
const metaDialog = fs.readFileSync(new URL("../js/editor/MetaBlockDialog.js", import.meta.url), "utf8");

assert.match(confirmation, /card-delete-confirmation/);
assert.match(confirmation, /Отмена/);
assert.match(confirmation, /Удалить/);
assert.match(canvas, /remove\.textContent = "🗑"/);
assert.match(canvas, /this\.collapsedNodes\.add\(nodeId\)/);
assert.match(canvas, /countSubtree\(node\)/);
assert.match(canvas, /Всего будет удалено/);
assert.match(canvas, /showCardDeleteConfirmation\(card/);
assert.match(publications, /showCardDeleteConfirmation\(card/);
assert.doesNotMatch(publications, /if \(!confirm\(/);
assert.match(library, /showCardDeleteConfirmation\(item/);
assert.match(metaDialog, /showCreateConfirmation/);
assert.match(metaDialog, /Создать Meta Block/);

console.log("card_delete_confirmation_contract_smoke: OK");
