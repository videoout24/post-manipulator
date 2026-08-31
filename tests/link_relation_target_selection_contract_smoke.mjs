import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const drafts = await readFile(new URL("../js/editor/DraftListView.js", import.meta.url), "utf8");
const projectPosts = await readFile(new URL("../js/editor/ProjectPostListView.js", import.meta.url), "utf8");
const projectLibrary = await readFile(new URL("../js/project/ProjectLibraryView.js", import.meta.url), "utf8");
const editorPanel = await readFile(new URL("../js/editor/EditorRightPanel.js", import.meta.url), "utf8");
const publications = await readFile(new URL("../js/publications/PublicationView.js", import.meta.url), "utf8");
const linkingController = await readFile(new URL("../js/links/LinkingController.js", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

// Every target is chosen only through an explicit \u2199 button. Card clicks keep
// their normal navigation behaviour and must never be part of link selection.
assert.match(drafts, /createLinkTargetButton/);
assert.match(drafts, /button\("\u2199"/);
assert.match(drafts, /linkTargetVisualState/);
assert.match(drafts, /is-\$\{state\}/);
assert.match(drafts, /kind: "draft"/);
assert.match(drafts, /kind: "publication"/);
assert.doesNotMatch(drafts, /onSelectTarget\?\.\(linkTargetForDraft\(draft\)\)/);
assert.match(projectPosts, /kind: "project_post"/);
assert.match(projectPosts, /createLinkTargetButton/);
assert.match(projectPosts, /button\("\u2199"/);
assert.doesNotMatch(projectPosts, /if \(onSelectTarget\?\.\(target\)\) return/);
assert.match(projectLibrary, /kind: "project_post"/);
assert.match(projectLibrary, /links:target-selected/);
assert.doesNotMatch(projectLibrary, /linkTargetSelectionActive/);
assert.match(editorPanel, /onSelectTarget: target => this\.#selectLinkTarget\(target\)/);
assert.match(editorPanel, /links:target-selected/);
assert.doesNotMatch(editorPanel, /linkTargetSelectionActive/);
assert.match(publications, /card\.dataset\.publicationId/);
assert.match(publications, /kind: "publication"/);
assert.match(publications, /links:target-selected/);
assert.match(publications, /createLinkTargetButton/);
assert.match(publications, /button\("\u2199"/);
assert.doesNotMatch(publications, /linkTargetSelectionActive/);
assert.doesNotMatch(publications, /card\.onclick[\s\S]{0,500}selectTarget\(\)/);

// A green target represents an existing relation. Its ↙ opens the source of
// that relation instead of forwarding the target to LinkingController (which
// used to remove the newest relation). Idle and yellow buttons still select a
// target slot.
assert.match(drafts, /state === "linked" \? onOpenLinkedSource : onSelectTarget/);
assert.match(projectPosts, /state === "linked" \? onOpenLinkedSource : onSelectTarget/);
assert.match(projectLibrary, /state === "linked" \? onOpenLinkedSource : onSelect/);
assert.match(publications, /state === "linked" \? onOpenLinkedSource : onSelect/);
assert.match(editorPanel, /onOpenLinkedSource: target => this\.#openLinkedSource\(target\)/);
assert.match(editorPanel, /links:open-linked-source-requested/);
assert.match(projectLibrary, /onOpenLinkedSource: target => this\.#openLinkedSource\(target\)/);
assert.match(projectLibrary, /links:open-linked-source-requested/);
assert.match(publications, /onOpenLinkedSource: target => this\.#openLinkedSource\(target\)/);
assert.match(publications, /links:open-linked-source-requested/);

assert.match(app, /LinkRelationNavigator/);
assert.match(app, /linkRelationNavigator/);

// The active card target is a global slot, not the old pending selection mode.
assert.match(linkingController, /links:target-slot-changed/);
assert.doesNotMatch(linkingController, /altKey/);
assert.doesNotMatch(linkingController, /links:selection-mode-changed/);
assert.doesNotMatch(app, /confirmLinkRelation/);
assert.doesNotMatch(app, /links:selection-mode-changed/);

console.log("link_relation_target_selection_contract_smoke: OK");
