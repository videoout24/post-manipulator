import assert from "node:assert/strict";
import { t } from "../js/i18n/index.js?v=1.8.0";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);
const renderer = new TelegramRenderer(registry);
const tree = { root: { children: [
  { type: "table", props: { cells: [[{ text: "A" }]], isCompact: true }, children: [] },
  { type: "expandable_block_quotation", props: { text: "Скрытая цитата", credit: "Автор" }, children: [] },
  { type: "document", props: { fileId: "telegram-document-id", caption: "Файл" }, children: [] }
] } };
const blocks = renderer.render(tree).blocks;
assert.equal(blocks[0].is_compact, true);
assert.equal(blocks[1].type, "expandable_blockquote");
assert.equal(blocks[1].text, "Скрытая цитата");
assert.equal("blocks" in blocks[1], false);
assert.equal(blocks[1].credit, "Автор");
assert.equal(registry.get("block_quotation").name, t("blocks.registerCoreBlocks.quotes"));
assert.equal(registry.get("expandable_block_quotation").paletteHidden, true);
assert.equal(blocks[2].type, "document");
assert.equal(blocks[2].document.type, "document");
assert.equal(blocks[2].document.media, "telegram-document-id");
console.log("rich_message_103_smoke: OK");
