import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const sizing = read("../js/editor/SessionTextareaSizing.js");
const inspector = read("../js/editor/BlockInspector.js");
const treeView = read("../js/editor/TreeView.js");
const drafts = read("../js/editor/DraftListView.js");
const posts = read("../js/editor/ProjectPostListView.js");
const gallery = read("../js/gallery/GalleryView.js");
const workspace = read("../js/app/createEditorWorkspace.js");
const shell = read("../js/app/createEditorShell.js");

assert.match(sizing, /attach\(textarea, \{ key = "", defaultRows = 1, minRows = 1/,
  "shared textarea sizing must start at one row");
assert.match(sizing, /refresh\(textarea, \{ key = "", defaultRows = 1, minRows = 1/,
  "shared refresh must use the same one-row default");
assert.doesNotMatch(inspector, /defaultRows:\s*3|return 3/,
  "block property editors must not retain three-row defaults");
assert.match(treeView, /key: `\$\{node\.id\}:ai\.prompt`/,
  "block AI prompts must use shared session autosizing");
assert.match(drafts, /key: `draft:\$\{draft\.id\}:ai\.documentPrompt`/,
  "whole-draft prompts must use shared session autosizing");
assert.match(posts, /key: `project-post:\$\{project\.id\}:\$\{post\.id\}:ai\.documentPrompt`/,
  "whole-post prompts must use shared session autosizing");
assert.match(gallery, /key: "gallery:upload-caption"/,
  "the remaining free-form caption textarea must use the same sizing behavior");
assert.match(workspace, /textareaSizing: inlineProperties\.textareaSizing/);
assert.match(shell, /textareaSizing: inlineProperties\?\.textareaSizing/);

for (const source of [treeView, drafts, posts, gallery]) {
  assert.doesNotMatch(source, /rows\s*=\s*3|rows="3"/,
    "visible editor textareas must not start at three rows");
}

console.log("textarea_sizing_consistency_smoke: OK");
