import { createDefaultPropertyRegistry } from "../core/PropertyRegistry.js?v=1.7.11";
import { createTelegramFormattingRegistry } from "../core/FormattingRegistry.js?v=1.7.9";
import { BlockRegistry } from "../core/BlockRegistry.js?v=1.5.9";
import { MetaBlockRegistry } from "../core/MetaBlockRegistry.js?v=1.7.0";
import { SelectionModel } from "../core/SelectionModel.js?v=1.5.9";
import { BlockTree } from "../core/BlockTree.js?v=1.5.9";
import { Validator } from "../core/Validator.js?v=1.5.9";
import { registerTelegramCore } from "../blocks/registerCoreBlocks.js?v=1.7.9";
import { registerProjectBlocks } from "../blocks/registerProjectBlocks.js?v=1.7.11";
import { EditorController } from "../editor/EditorController.js?v=1.5.9";
import { FormulaTemplateLibrary } from "../editor/FormulaTemplateLibrary.js?v=1.5.9";
import { DraftStore } from "../editor/DraftStore.js?v=1.7.14";
import { DraftEditorSession } from "../editor/DraftEditorSession.js?v=1.5.9";
import { TelegramRenderer } from "../telegram/TelegramRenderer.js?v=1.5.9";
import { Storage } from "../storage/Storage.js?v=1.7.0";
import { migrateDocumentTree } from "../core/DocumentMigrations.js?v=1.5.9";

export function createEditorDomain({ db, events, storage = new Storage(), initialDocument = undefined, initialMetaBlocks = undefined } = {}) {
  const formatting = createTelegramFormattingRegistry();
  const properties = createDefaultPropertyRegistry(formatting);
  const registry = new BlockRegistry(properties);
  registerTelegramCore(registry);
  registerProjectBlocks(registry);
  const metaRegistry = new MetaBlockRegistry(registry, { db, initialBlocks: initialMetaBlocks });

  const saved = initialDocument === undefined ? storage.load() : initialDocument;
  const tree = new BlockTree(saved);
  migrateDocumentTree(tree);
  const validator = new Validator(registry);
  const selection = new SelectionModel(events);
  const controller = new EditorController({ tree, registry, validator, events, selection });
  const draftStore = new DraftStore({ db, events });
  const draftSession = new DraftEditorSession({ store: draftStore, tree, events });
  const formulaTemplates = new FormulaTemplateLibrary({ db, events });
  formulaTemplates.start();
  const renderer = new TelegramRenderer(registry);

  return Object.freeze({
    formatting,
    properties,
    registry,
    metaRegistry,
    storage,
    tree,
    validator,
    selection,
    controller,
    draftStore,
    draftSession,
    formulaTemplates,
    renderer,
    dragState: { nodeId: "", type: "", source: "", galleryAssetId: "", galleryType: "" },
    richTextContext: { active: null }
  });
}
