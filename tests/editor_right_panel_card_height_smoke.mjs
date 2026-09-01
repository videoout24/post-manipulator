import assert from "node:assert/strict";
import fs from "node:fs";

const drafts = fs.readFileSync(new URL("../js/editor/DraftListView.js", import.meta.url), "utf8");
const projectCards = fs.readFileSync(new URL("../js/project/ProjectPostCard.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(drafts, /else card\.classList\.add\("no-footer-actions"\)/);
assert.match(projectCards, /const noFooter = variant === "compact" && !hasPublicationFooter/);
assert.match(projectCards, /noFooter \? " no-footer-actions" : ""/);
assert.match(css,
  /\.project-post-panel \.project-post-card-compact\.no-footer-actions[^}]*[\s\S]*?min-height:\s*68px/,
  "compact Project and Draft cards without footers must remain comfortably tall"
);
assert.match(css,
  /\.project-post-panel \.project-post-card-overlay\s*\{[^}]*position:\s*relative;[^}]*min-height:\s*76px;/s,
  "right-panel inline forms must participate in card height"
);

console.log("editor_right_panel_card_height_smoke: OK");
