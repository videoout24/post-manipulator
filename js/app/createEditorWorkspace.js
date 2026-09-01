import { BlockPalette } from "../editor/BlockPalette.js?v=1.5.9";
import { BlockInspector } from "../editor/BlockInspector.js?v=1.7.6";
import { TreeView } from "../editor/TreeView.js?v=1.5.9";
import { MediaAssetBinder } from "../editor/MediaAssetBinder.js?v=1.5.9";
import { EditorAssetPicker } from "../editor/EditorAssetPicker.js?v=1.5.9";
import { EditorWorkspaceView } from "../editor/EditorWorkspaceView.js?v=1.5.9";

export function createEditorWorkspace({
  documentRoot = document,
  events,
  tree,
  registry,
  metaRegistry = null,
  controller,
  validator,
  formulaTemplates,
  richTextContext,
  projectSession,
  draftSession = null,
  dragState,
  gallery,
  thumbnails,
  notifications,
  editorCanvasPreferences = null
} = {}) {
  const inlineProperties = new BlockInspector({
    root: null,
    registry,
    controller,
    formulaTemplates,
    richTextContext,
    projectContext: projectSession,
    events
  });
  const palette = new BlockPalette({
    root: documentRoot.querySelector("#palette"),
    categoryRoot: documentRoot.querySelector("#blockCategoryFilters"),
    registry,
    metaRegistry,
    controller,
    dragState,
    richTextContext,
    projectContext: projectSession
  });
  const mediaBinder = new MediaAssetBinder({ tree, registry, controller, gallery, events });
  const autoCollapseInactiveCheckbox = documentRoot.querySelector("#editorAutoCollapseInactive");
  if (autoCollapseInactiveCheckbox && editorCanvasPreferences) {
    autoCollapseInactiveCheckbox.checked = editorCanvasPreferences.autoCollapseInactive;
  }
  const treeView = new TreeView({
    root: documentRoot.querySelector("#canvas"),
    tree,
    registry,
    validator,
    controller,
    dragState,
    mediaBinder,
    gallery,
    thumbnails,
    inlineInspector: inlineProperties,
    autoCollapseInactive: autoCollapseInactiveCheckbox?.checked === true
  });

  const blockPaletteMode = documentRoot.querySelector("#blockPaletteMode");
  const assetPickerMode = documentRoot.querySelector("#assetPickerMode");
  const openAssetPickerButton = documentRoot.querySelector("#openAssetPicker");
  const toggleAllBlocksButton = documentRoot.querySelector("#editorToggleAllBlocks");
  let workspace = null;
  const assetPicker = assetPickerMode ? new EditorAssetPicker({
    root: assetPickerMode,
    gallery,
    thumbnails,
    binder: mediaBinder,
    tree,
    controller,
    events,
    dragState,
    onBack: nodeId => workspace?.suppressAssetPicker(nodeId)
  }) : null;

  workspace = new EditorWorkspaceView({
    tree,
    controller,
    validator,
    projectSession,
    draftSession,
    treeView,
    palette,
    mediaBinder,
    assetPicker,
    blockPaletteMode,
    assetPickerMode,
    openAssetPickerButton,
    toggleAllBlocksButton,
    autoCollapseInactiveCheckbox,
    editorCanvasPreferences,
    statsRoot: documentRoot.querySelector("#canvasStats"),
    onError: error => notifications?.show?.({
      message: `Gallery picker: ${error?.message || error}`,
      type: "error"
    }),
    documentRoot
  });
  treeView.onCollapseChange = state => workspace?.renderCollapseControl(state);

  return Object.freeze({
    inlineProperties,
    palette,
    mediaBinder,
    treeView,
    assetPicker,
    workspace,
    openAssetPickerButton
  });
}
