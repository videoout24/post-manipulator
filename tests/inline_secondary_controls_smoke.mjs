import assert from "node:assert/strict";
import fs from "node:fs";
import { canvasScrollDuration } from "../js/editor/TreeView.js";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const treeView = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");

assert.match(inspector, /node\.type === "heading"[\s\S]*?mountPropertyLabelAccessory\(host, "content\.text", makeHeadingSizeControl/);
assert.match(inspector, /node\.type === "mathematical_expression"[\s\S]*?host\.querySelector\("\.formula-import-control"\)[\s\S]*?mountPropertyLabelAccessory\(host, "math\.expression", control\)/,
  "Formula JSON import must live beside the LaTeX field label");
assert.match(inspector, /node\.type === "preformatted"[\s\S]*?mountPropertyLabelAccessory\(host, "content\.text", makeCompactTextControl/);
assert.match(inspector, /node\.type === "details"[\s\S]*?mountPropertyLabelAccessory\(host, "details\.summary", makeCompactCheckbox/);
assert.doesNotMatch(inspector, /mountRichFooterAccessory/, "Compact secondary controls must not remain in RichText footers");
assert.match(inspector, /toolbar\.append\(dimensions,[^;]*importButton, fileInput\)/, "Table import must live in the top control row");
assert.doesNotMatch(inspector, /table-import-row/, "Table import must not create a bottom row");
assert.match(inspector, /importControl\.className = "formula-import-control"/);
assert.doesNotMatch(inspector, /formula-import-row/, "Formula import must not create a bottom row");
assert.match(inspector, /textarea\.value = `\$\{value\.slice\(0, cursor\)\}\$\{template\.latex\}\$\{value\.slice\(cursor\)\}`/,
  "Formula templates must be inserted at the caret instead of replacing the expression");
assert.match(treeView, /if \(!additive && !isFormControl\) \{[\s\S]*?if \(this\.autoCollapseInactive\) this\.focusNode\(node\.id\);[\s\S]*?else this\.scrollNodeNearCanvasTop\(node\.id\);[\s\S]*?\}/,
  "A Canvas card click must position its active block in both auto-collapse and regular modes");
assert.match(treeView, /input, textarea, select, button, summary, \[contenteditable='true'\], \[contenteditable='plaintext-only'\]/,
  "Collapsible property summaries must not trigger a Canvas re-render before their native toggle runs");
assert.match(treeView, /focusNode\(nodeId, \{ reposition = true \} = \{\}\)[\s\S]*?expandedPath\.add\(String\(current\.id\)\)[\s\S]*?this\.collapsedNodes = new Set\(this\.#canvasNodeIds\(\)\.filter\(id => !expandedPath\.has\(id\)\)\)/,
  "Focusing a Canvas block must collapse all other branches while keeping its ancestor path open");
assert.match(treeView, /scrollNodeNearCanvasTop\(nodeId, offset = 100\)[\s\S]*?if \(speed === 0\) return;[\s\S]*?scroller\.scrollTop \+ targetRect\.top - scrollerRect\.top - offset/,
  "The focused block must be positioned near the Canvas top with a 100px offset");
assert.match(treeView, /if \(generation !== this\.renderGeneration \|\| animationRevision !== this\.scrollAnimationRevision\) return;/,
  "A stale focus scroll must not override a newer Canvas selection");
assert.match(treeView, /this\.focusNode\(selectedId, \{ reposition: false \}\)/,
  "Enabling auto-collapse must not unexpectedly reposition the Canvas");
assert.deepEqual([0, 1, 2, 3].map(canvasScrollDuration), [0, 900, 600, 300],
  "scroll levels must map off/slow/half-speed/former-speed predictably");
assert.match(treeView, /Array\.from\(scope\.options\)\.some\(option => option\.value === scope\.value\)/,
  "AI field scope validation must not call an undefined CSS selector helper while rendering Canvas blocks");
assert.doesNotMatch(treeView, /cssEscape\(scope\.value\)/,
  "Rendering an AI prompt must not depend on an unavailable cssEscape helper");

console.log("inline_secondary_controls_smoke: OK");
