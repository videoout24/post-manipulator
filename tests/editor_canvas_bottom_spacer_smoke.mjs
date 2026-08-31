import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, viewportController] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../js/telegram/TelegramViewportController.js", import.meta.url), "utf8")
]);

assert.match(html, /<div aria-hidden="true" class="canvas-bottom-spacer"><\/div>/);
assert.match(css, /\.canvas-bottom-spacer\s*\{[^}]*height:\s*var\(--editor-bottom-spacer-height,\s*50vh\)/s);
assert.match(viewportController, /--editor-bottom-spacer-height[^\n]+viewportHeight \/ 2/);

console.log("editor_canvas_bottom_spacer_smoke: OK");
