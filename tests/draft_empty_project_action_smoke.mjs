import assert from "node:assert/strict";
import fs from "node:fs";
import { draftHasBlocks } from "../js/editor/DraftListView.js?v=1.5.9";

assert.equal(draftHasBlocks(null), false);
assert.equal(draftHasBlocks({ messageAst: { children: [] } }), false);
assert.equal(draftHasBlocks({ messageAst: { children: [{ id: "p", type: "paragraph" }] } }), true);

const source = fs.readFileSync(new URL("../js/editor/DraftListView.js", import.meta.url), "utf8");
assert.match(source, /if \(draftHasBlocks\(draft\)\) \{[\s\S]*?button\(t\("editor\.draftListView\.toProject"\)[\s\S]*?button\(t\("editor\.draftListView\.postpone"\)[\s\S]*?onSchedule/);
assert.doesNotMatch(source, /placeholderButton/);

console.log("draft empty project action smoke: OK");
