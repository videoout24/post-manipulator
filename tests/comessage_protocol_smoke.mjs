import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { BlockRegistry } from "../js/core/BlockRegistry.js";
import { BlockTree } from "../js/core/BlockTree.js";
import { SelectionModel } from "../js/core/SelectionModel.js";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js";
import { Validator } from "../js/core/Validator.js";
import { comessageMutationError, isComessageValue } from "../js/core/Comessage.js";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js";
import { EditorController } from "../js/editor/EditorController.js";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js";
import { importTelegramRichMessage } from "../js/telegram/TelegramRichMessageImporter.js";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);
const tree = new BlockTree({
  id: "root", type: "document", props: {},
  children: [{ id: "paragraph-1", type: "paragraph", props: { text: "Local version" }, children: [] }]
});
const events = new EventBus();
const selection = new SelectionModel(events);
const draftSession = { draft: { id: "draft-1", source: null } };
const controller = new EditorController({ tree, registry, validator: new Validator(registry), events, selection });
controller.setDocumentContextResolver(() => true);
controller.setMutationGuard(request => comessageMutationError(request, {
  tree,
  draftSession,
  projectSession: { isProjectActive: () => false }
}));

const marker = controller.addBlock("comessage", "root", Infinity);
assert(marker, "CoMessage block must be insertable into a Draft");
assert.equal(tree.root.children[0].id, marker.id, "CoMessage is always inserted as the first root block");
assert(isComessageValue(marker.props.hashtag), "the editor generates a random protocol marker");
assert.equal(controller.addBlock("comessage", "root", 0), null, "a second marker is rejected");
assert.equal(controller.addBlock("paragraph", "root", 0), null, "nothing can be inserted before the marker");

const renderer = new TelegramRenderer(registry);
const envelope = renderer.renderEnvelope(tree);
assert.deepEqual(envelope.richMessage.blocks[0], {
  type: "paragraph",
  text: { type: "hashtag", text: marker.props.hashtag, hashtag: marker.props.hashtag }
});
const imported = importTelegramRichMessage(envelope.richMessage);
assert.equal(imported.children[0].type, "comessage");
assert.equal(imported.children[0].props.hashtag, marker.props.hashtag);
assert.deepEqual(new Validator(registry).validate(new BlockTree(imported)), []);

const invalid = new BlockTree({
  id: "root", type: "document", props: {}, children: [
    { id: "p", type: "paragraph", props: { text: "Before" }, children: [] },
    { id: "m", type: "comessage", props: { hashtag: marker.props.hashtag }, children: [] }
  ]
});
assert.match(new Validator(registry).validate(invalid).join("\n"), /first block/);

draftSession.draft.source = { kind: "publication", publicationId: "published-1" };
assert.equal(controller.removeBlock(marker.id), false, "the marker stays locked while its publication exists");
assert.equal(controller.updateNodeProperties(marker.id, { hashtag: "#comessage_changed" }), undefined,
  "the marker identity cannot be edited");

console.log("comessage protocol smoke: OK");
