import { readStylesSync } from "./read_styles.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyUrlPrefix, normalizeUrlValue } from "../js/editor/BlockInspector.js?v=1.5.9";

assert.equal(applyUrlPrefix("example.com/path", "https://"), "https://example.com/path");
assert.equal(applyUrlPrefix("http://example.com/path", "https://"), "https://example.com/path");
assert.equal(applyUrlPrefix("https://t.me/example", "tg://"), "tg://t.me/example");
assert.equal(applyUrlPrefix("http://example.com", "unsupported:"), "https://example.com");
assert.equal(normalizeUrlValue("google.com"), "https://google.com");
assert.equal(normalizeUrlValue("ia.ru/path"), "https://ia.ru/path");
assert.equal(normalizeUrlValue("tg://resolve?domain=example"), "tg://resolve?domain=example");
assert.equal(normalizeUrlValue("not a URL"), "not a URL");

const inspector = fs.readFileSync(new URL("../js/editor/BlockInspector.js", import.meta.url), "utf8");
const css = readStylesSync();
assert.match(inspector, /\["text_link", "url_button"\]\.includes\(node\.type\)/);
assert.match(inspector, /makeUrlPrefixControl\(\(\) => panel\.querySelector/);
for (const prefix of ["https://", "tg://"]) assert.ok(inspector.includes(`"${prefix}"`));
for (const prefix of ["http://", "mailto:", "tel:"]) assert.ok(!inspector.includes(`"${prefix}"`));
assert.match(css, /\.url-prefix-control\s*\{/);

console.log("url_prefix_controls_smoke: OK");
