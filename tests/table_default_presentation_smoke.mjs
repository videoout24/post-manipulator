import assert from "node:assert/strict";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";

const properties = createDefaultPropertyRegistry(createTelegramFormattingRegistry());
assert.equal(properties.get("table.isBordered").default, true);
assert.equal(properties.get("table.isStriped").default, true);
assert.equal(properties.get("table.isCompact").default, false);
assert.equal(properties.get("table.cell.align").default, "center");
assert.equal(properties.get("table.cell.valign").default, "middle");

console.log("table_default_presentation_smoke: OK");
