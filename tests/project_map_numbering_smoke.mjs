import assert from "node:assert/strict";
import fs from "node:fs";
import { projectMapEntryText, projectMapNumber } from "../js/project/ProjectMapText.js?v=1.7.11";

assert.equal(projectMapEntryText({ numbering: "numeric" }, { text: "Введение" }, 0), "1. Введение");
assert.equal(projectMapEntryText({ numbering: "none" }, { text: "Введение" }, 0), "Введение");
assert.equal(projectMapEntryText({ numbering: "latin_upper" }, { text: "Введение" }, 0), "A. Введение");
assert.equal(projectMapEntryText({ numbering: "roman_upper" }, { text: "Введение" }, 3), "IV. Введение");
assert.equal(projectMapNumber("latin_upper", 25), "Z");
assert.equal(projectMapNumber("latin_upper", 26), "AA");
assert.equal(projectMapNumber("roman_upper", 39), "XL");
assert.equal(
  projectMapEntryText({ numbering: "numeric", prefix: "Legacy ", separator: " · " }, { text: "Введение" }, 1),
  "2. Введение",
  "legacy prefix and separator must not affect Map rendering"
);

const properties = fs.readFileSync(new URL("../js/core/PropertyRegistry.js", import.meta.url), "utf8");
const blocks = fs.readFileSync(new URL("../js/blocks/registerProjectBlocks.js", import.meta.url), "utf8");
assert.doesNotMatch(properties, /project\.map\.(?:prefix|separator)/);
assert.doesNotMatch(blocks, /project\.map\.(?:prefix|separator)/);
for (const option of ["numeric", "latin_upper", "roman_upper", "none"]) assert.ok(properties.includes(`value: "${option}"`));

console.log("project_map_numbering_smoke: OK");
