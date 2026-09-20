import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readStyles } from "./read_styles.mjs";

const [inspector, properties, blocks, css] = await Promise.all([
  readFile(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8"),
  readFile(new URL("../js/core/PropertyRegistry.js", import.meta.url), "utf8"),
  readFile(new URL("../js/blocks/registerCoreBlocks.js", import.meta.url), "utf8"),
  readStyles()
]);

const locationEditorStart = inspector.indexOf("  makeLocationEditor({");
const locationEditor = inspector.slice(
  locationEditorStart,
  inspector.indexOf("  makeRichTextEditor({", locationEditorStart)
);
assert.match(locationEditor, /resolveMapLink\(source\)/);
assert.match(locationEditor, /link\.type = "text"/);
assert.match(locationEditor, /const applyLink = \(\) => \{\s*showStatus\(\);/);
assert.match(locationEditor, /className = "map-settings-row"/);
assert.match(locationEditor, /for \(const orientation of \["landscape", "portrait"\]\)/);
assert.match(locationEditor, /refreshOrientationButtons\(mapOrientation\(node\?\.props\)\)/);
assert.match(locationEditor, /numericField\(t\("core\.propertyRegistry\.zoom"\),[\s\S]*?, 1, 20\)/);
assert.doesNotMatch(locationEditor, /horizontal_accuracy|accuracyM/);
assert.doesNotMatch(locationEditor, /numericField\(t\("editor\.blockInspector\.(?:latitude|longitude)"/);

assert.match(properties, /add\("map\.zoom", \{[\s\S]*?min: 1, max: 20/);
assert.match(properties, /add\("map\.orientation", \{/);
assert.match(properties, /add\("map\.width", \{[\s\S]*?deprecated: true/);
assert.match(properties, /add\("map\.height", \{[\s\S]*?deprecated: true/);
assert.match(blocks, /prop\("map\.sourceUrl", "mapUrl"\)/);
assert.doesNotMatch(blocks.slice(blocks.indexOf('type:"map"'), blocks.indexOf('type:"animation"')), /prop\("map\.(?:width|height)"/);
assert.match(css, /\.map-settings-row \{[^}]*grid-template-columns: minmax\(72px, \.65fr\) 1fr 1fr;/);
assert.match(css, /\.map-orientation-button\[aria-pressed="true"\]/);

console.log("map_editor_contract_smoke: OK");
