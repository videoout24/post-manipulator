import assert from "node:assert/strict";
import fs from "node:fs";
import { draftHasBlocks } from "../js/editor/DraftListView.js?v=1.5.9";

assert.equal(draftHasBlocks(null), false);
assert.equal(draftHasBlocks({ messageAst: { children: [] } }), false);
assert.equal(draftHasBlocks({ messageAst: { children: [{ id: "p", type: "paragraph" }] } }), true);

const source = fs.readFileSync(new URL("../js/editor/DraftListView.js", import.meta.url), "utf8");
assert.match(source, /if \(draftHasBlocks\(draft\)\) \{[\s\S]*?button\("В проект"[\s\S]*?placeholderButton\("Отложить"/);
assert.doesNotMatch(source, /if \(!publicationCopy\) actions\.append\(placeholderButton\("Отложить"/);

console.log("draft empty project action smoke: OK");
