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
const closeDraftMethod = panel.match(/async #cancelPublicationEdit\(draft\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.match(closeDraftMethod, /#finishPublicationEdit\(draft, "publication-edit-cancelled"\)/,
  "closing a retained published draft must save and close it");
assert.doesNotMatch(closeDraftMethod, /onApplyDraftChanges/,
  "closing a retained published draft must not silently apply it to Telegram");
assert.match(panel, /for \(const postId of changedPostIds\)[\s\S]*?onApplyProjectChanges\?\.\(current\.id, post\.id\)[\s\S]*?closeProject/,
  "closing a project must apply every changed published post first");

console.log("published editor close contract smoke: OK");
