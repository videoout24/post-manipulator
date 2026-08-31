import assert from "node:assert/strict";
import fs from "node:fs";

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(inspector, /controls\.append\(makeUrlPrefixControl\(\)\)/);
assert.match(inspector, /controls\.append\(relation\)/);
assert.match(css, /\.prop-label-accessory\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*gap:\s*4px/s);
assert.match(css, /\.url-prefix-control\s*\{[^}]*flex-wrap:\s*nowrap/s);
assert.match(css, /\.prop-label-accessory \.link-relation-block-button\s*\{[^}]*width:\s*21px[^}]*height:\s*21px[^}]*border-radius:\s*5px/s);

console.log("url_prefix_controls_contract_smoke: OK");
