import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../style.css", import.meta.url), "utf8");

assert.match(css, /\.workspace\s*\{[^}]*height:\s*calc\(var\(--app-viewport-height\)\s*-\s*56px\)/s);
assert.match(css, /\.layout\s*\{\s*height:\s*100%;/s);
for (const selector of ["gallery-details", "publication-post-panel", "project-library-post-panel"]) {
  assert.doesNotMatch(css, new RegExp(`\\.${selector}[^\\{]*\\{[^\\}]*position:\\s*absolute`, "s"), `${selector} must not overlay the center column`);
}
assert.doesNotMatch(css, /\.layout\.project-active \.project-post-panel\s*\{[^}]*position:\s*absolute/s);
assert.match(css, /\.layout\.project-active\s*\{\s*grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*--editor-project-width/s);
assert.match(css, /\.gallery-layout\s*\{\s*grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*--gallery-right-width/s);
assert.match(css, /\.project-library-layout\s*\{[\s\S]*?grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*--project-library-right-width/);
assert.match(css, /\.publication-shell\s*\{[^}]*grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*--publications-right-width/s);

console.log("non_overlapping_panels_contract_smoke: OK");
