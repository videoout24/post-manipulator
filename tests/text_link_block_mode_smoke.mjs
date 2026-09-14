import assert from "node:assert/strict";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { INLINE_SEMANTIC_TYPES } from "../js/core/SemanticRichText.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);

assert.equal(registry.get("text_link").semantic?.inline, false,
  "Text Link from the palette must create a standalone block");
assert.equal(INLINE_SEMANTIC_TYPES.has("text_link"), false,
  "Text Link must no longer be classified as an inline semantic entity");
const formatting = createTelegramFormattingRegistry();
assert.deepEqual(formatting.get("code").exclusiveWith, ["url", "date_time"]);
assert.deepEqual(formatting.get("url").exclusiveWith, ["code", "date_time"]);

console.log("text_link_block_mode_smoke: OK");
