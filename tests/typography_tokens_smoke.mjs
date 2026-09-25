import assert from "node:assert/strict";
import fs from "node:fs";
import { readStylesSync } from "./read_styles.mjs";

const css = readStylesSync();
const baseCss = fs.readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const expectedSizes = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 34, 54];

for (const size of expectedSizes) {
  assert.match(
    baseCss,
    new RegExp(`--font-size-${size}:\\s*${size}px;`),
    `font size ${size}px must be defined in the central type scale`
  );
}

assert.doesNotMatch(
  css,
  /(?:^|[;{])\s*font-size\s*:\s*\d+(?:\.\d+)?(?:px|rem|em|pt)\b/m,
  "component font-size declarations must use central variables"
);
assert.doesNotMatch(
  css,
  /(?:^|[;{])\s*font\s*:\s*[^;}]*\d+(?:\.\d+)?(?:px|rem|em|pt)\b/m,
  "font shorthand declarations must use central variables"
);

const definedTokens = new Set([...baseCss.matchAll(/--font-size-(\d+)\s*:/g)].map(([, size]) => size));
for (const [, size] of css.matchAll(/var\(--font-size-(\d+)\)/g)) {
  assert(definedTokens.has(size), `font size token ${size} must be centrally defined`);
}

console.log("typography tokens smoke: OK");
