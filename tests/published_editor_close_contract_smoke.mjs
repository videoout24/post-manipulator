import assert from "node:assert/strict";
import fs from "node:fs";
import { unappliedPublishedPostIds } from "../js/editor/EditorRightPanel.js";

const project = {
  posts: [
    { id: "clean", publication: { state: "published", hasUnappliedChanges: false }, deployments: { production: { messageId: 1 } } },
    { id: "changed", publication: { state: "published", hasUnappliedChanges: true }, deployments: { production: { messageId: 2 } } },
    { id: "draft", publication: { state: "draft", hasUnappliedChanges: true }, deployments: {} }
  ]
};
assert.deepEqual(unappliedPublishedPostIds(project), ["changed"]);

const panel = fs.readFileSync(new URL("../js/editor/EditorRightPanel.js", import.meta.url), "utf8");
assert.match(panel, /if \(draft\.source\?\.retained\)[\s\S]*?onApplyDraftChanges\?\.\(draft\.id\)[\s\S]*?#finishPublicationEdit/,
  "closing a retained published draft must apply it before closing");
assert.match(panel, /for \(const postId of changedPostIds\)[\s\S]*?onApplyProjectChanges\?\.\(current\.id, post\.id\)[\s\S]*?closeProject/,
  "closing a project must apply every changed published post first");

console.log("published editor close contract smoke: OK");
