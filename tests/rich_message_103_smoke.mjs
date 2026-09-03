import assert from "node:assert/strict";
import { t } from "../js/i18n/index.js?v=1.8.0";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { countBlocks } from "../js/core/DocumentLimits.js?v=1.7.17";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { Validator } from "../js/core/Validator.js?v=1.7.17";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);
const renderer = new TelegramRenderer(registry);
const tree = { root: { children: [
  { type: "table", props: { cells: [[{ text: "A" }]], isCompact: true }, children: [] },
  { type: "expandable_block_quotation", props: { text: "Скрытая цитата", credit: "Автор" }, children: [] },
  { type: "button_row", props: { buttonAlign: "right" }, children: [
    { type: "url_button", props: { text: "Первая", url: "https://example.com/first", buttonStyle: "success" }, children: [] },
    { type: "url_button", props: { text: "Вторая", url: "https://example.com/second", buttonStyle: "danger" }, children: [] }
  ] },
  { type: "url_button", props: { text: "Старая", url: "https://example.com/legacy", buttonStyle: "primary" }, children: [] },
  { type: "document", props: { fileId: "telegram-document-id", caption: "Файл" }, children: [] }
] } };
const envelope = renderer.renderEnvelope(tree);
const blocks = envelope.richMessage.blocks;
assert.equal(blocks[0].is_compact, true);
assert.equal(blocks[1].type, "expandable_blockquote");
assert.equal(blocks[1].text, "Скрытая цитата");
assert.equal("blocks" in blocks[1], false);
assert.equal(blocks[1].credit, "Автор");
assert.equal(registry.get("block_quotation").name, t("blocks.registerCoreBlocks.quotes"));
assert.equal(registry.get("expandable_block_quotation").paletteHidden, true);
assert.deepEqual(registry.get("button_row").wire, { kind: "rich_block", type: "buttons" });
assert.deepEqual(registry.get("button_row").children, { allowed: true, types: ["url_button"], minItems: 1, maxItems: 8 });
assert.deepEqual(registry.get("url_button").wire, { kind: "rich_button" });
assert.deepEqual(blocks[2], {
  type: "buttons",
  buttons: [
    { text: "Первая", url: "https://example.com/first", style: "success" },
    { text: "Вторая", url: "https://example.com/second", style: "danger" }
  ],
  align: "right"
});
assert.deepEqual(blocks[3], {
  type: "buttons",
  buttons: [{ text: "Старая", url: "https://example.com/legacy", style: "primary" }]
}, "legacy standalone buttons remain readable as one-button rows");
assert.deepEqual(envelope.replyMarkup, { inline_keyboard: [] }, "editing removes legacy inline keyboards");
assert.equal(blocks[4].type, "document");
assert.equal(blocks[4].document.type, "document");
assert.equal(blocks[4].document.media, "telegram-document-id");

const buttonOnlyTree = new BlockTree({
  id: "root",
  type: "document",
  props: {},
  children: [{ id: "button", type: "url_button", props: { text: "Открыть", url: "https://example.com" }, children: [] }]
});
assert.equal(countBlocks(buttonOnlyTree), 1, "native button rows count toward the RichBlock limit");
assert.deepEqual(new Validator(registry).validate(buttonOnlyTree), [], "a native button row is valid Rich Message content");
const rowTree = new BlockTree({
  id: "root",
  type: "document",
  props: {},
  children: [{
    id: "row",
    type: "button_row",
    props: { buttonAlign: "center" },
    children: Array.from({ length: 8 }, (_, index) => ({
      id: `button-${index}`,
      type: "url_button",
      props: { text: `Button ${index + 1}`, url: `https://example.com/${index + 1}` },
      children: []
    }))
  }]
});
assert.equal(countBlocks(rowTree), 1, "the row and its RichMessageButton children are one RichBlock");
assert.deepEqual(new Validator(registry).validate(rowTree), []);
rowTree.root.children[0].children.push({
  id: "button-9", type: "url_button", props: { text: "Too many", url: "https://example.com/9" }, children: []
});
assert.match(new Validator(registry).validate(rowTree).join("\n"), /button_row has too many children/);
console.log("rich_message_103_smoke: OK");
