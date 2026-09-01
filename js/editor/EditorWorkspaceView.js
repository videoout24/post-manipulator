import { t } from "../i18n/index.js?v=1.8.0";
export class EditorWorkspaceView {
  constructor({
    tree,
    controller,
    validator,
    projectSession = null,
    draftSession = null,
    treeView,
    palette,
    mediaBinder,
    assetPicker = null,
    blockPaletteMode = null,
    assetPickerMode = null,
    openAssetPickerButton = null,
    toggleAllBlocksButton = null,
    autoCollapseInactiveCheckbox = null,
    editorCanvasPreferences = null,
    statsRoot = null,
    onError = null,
    documentRoot = document
  } = {}) {
    this.tree = tree;
    this.controller = controller;
    this.validator = validator;
    this.projectSession = projectSession;
    this.draftSession = draftSession;
    this.treeView = treeView;
    this.palette = palette;
    this.mediaBinder = mediaBinder;
    this.assetPicker = assetPicker;
    this.blockPaletteMode = blockPaletteMode;
    this.assetPickerMode = assetPickerMode;
    this.openAssetPickerButton = openAssetPickerButton;
    this.toggleAllBlocksButton = toggleAllBlocksButton;
    this.autoCollapseInactiveCheckbox = autoCollapseInactiveCheckbox;
    this.editorCanvasPreferences = editorCanvasPreferences;
    this.statsRoot = statsRoot;
    this.onError = onError;
    this.documentRoot = documentRoot;
    this.suppressedNodeId = null;
    this.toggleAllBlocksButton?.addEventListener?.("click", () => this.toggleAllBlocks());
    if (this.autoCollapseInactiveCheckbox) {
      this.autoCollapseInactiveCheckbox.checked = this.editorCanvasPreferences?.autoCollapseInactive ?? this.autoCollapseInactiveCheckbox.checked;
      this.treeView?.setAutoCollapseInactive?.(this.autoCollapseInactiveCheckbox.checked);
      this.autoCollapseInactiveCheckbox.addEventListener?.("change", () => this.setAutoCollapseInactive(this.autoCollapseInactiveCheckbox.checked));
    }
  }

  render() {
    this.renderLeftPanel();
    const hasDocumentContext = this.hasDocumentContext();
    if (hasDocumentContext) this.treeView?.render?.();
    else this.treeView?.renderDocumentContextPlaceholder?.();
    this.renderCollapseControl();
    this.renderStats(hasDocumentContext);
  }

  hasDocumentContext() {
    if (!this.projectSession && !this.draftSession) return true;
    return Boolean(this.projectSession?.isProjectActive?.() || this.draftSession?.isActive?.());
  }

  renderLeftPanel() {
    const node = this.controller?.selectedId ? this.tree?.find?.(this.controller.selectedId) : null;
    if (this.suppressedNodeId && this.suppressedNodeId !== node?.id) this.suppressedNodeId = null;
    const supportsMedia = Boolean(node && this.mediaBinder?.supports?.(node));
    const showAssets = supportsMedia && this.suppressedNodeId !== node.id;
    if (this.blockPaletteMode) this.blockPaletteMode.hidden = showAssets;
    if (this.assetPickerMode) this.assetPickerMode.hidden = !showAssets;
    if (this.openAssetPickerButton) this.openAssetPickerButton.hidden = !(supportsMedia && !showAssets);
    if (showAssets) {
      this.assetPicker?.setNode?.(node.id)?.catch(error => this.onError?.(error));
    } else {
      this.palette?.render?.();
    }
  }

  renderStats(hasDocumentContext = this.hasDocumentContext()) {
    if (!this.statsRoot) return;
    if (!hasDocumentContext) {
      this.statsRoot.replaceChildren();
      return;
    }
    const stats = this.validator.stats(this.tree);
    this.statsRoot.replaceChildren(
      this.#makeStat(t("editor.editorWorkspaceView.blocks"), stats.blockCount, stats.maxBlocks),
      this.#makeStat(t("editor.editorWorkspaceView.depth"), stats.maxDepth, stats.maxDepthLimit)
    );
  }

  suppressAssetPicker(nodeId) {
    this.suppressedNodeId = nodeId || null;
    this.renderLeftPanel();
  }

  showAssetPicker() {
    this.suppressedNodeId = null;
    this.renderLeftPanel();
  }

  updateSelection() {
    this.treeView?.updateSelection?.();
    this.renderLeftPanel();
  }

  updateValidation() {
    this.treeView?.updateValidation?.();
  }

  toggleAllBlocks() {
    const state = this.treeView?.collapseState?.() || { total: 0, allCollapsed: false };
    if (!state.total) return;
    if (state.allCollapsed) this.treeView?.expandAll?.();
    else this.treeView?.collapseAll?.();
    this.renderCollapseControl();
  }

  setAutoCollapseInactive(enabled) {
    const next = Boolean(enabled);
    this.treeView?.setAutoCollapseInactive?.(next);
    this.editorCanvasPreferences?.setAutoCollapseInactive?.(next)
      ?.catch?.(error => this.onError?.(error));
  }

  renderCollapseControl(state = this.treeView?.collapseState?.()) {
    if (!this.toggleAllBlocksButton) return;
    const current = state || { total: 0, allCollapsed: false };
    this.toggleAllBlocksButton.disabled = !current.total;
    this.toggleAllBlocksButton.textContent = current.allCollapsed ? t("editor.editorWorkspaceView.expandAll") : t("editor.editorWorkspaceView.collapseAll");
    this.toggleAllBlocksButton.title = current.allCollapsed
      ? t("editor.editorWorkspaceView.expandAllBlocksOnCanvas")
      : t("editor.editorWorkspaceView.collapseAllBlocksOnCanvas");
  }

  #makeStat(label, value, limit) {
    const item = this.documentRoot.createElement("span");
    const ratio = limit ? value / limit : 0;
    item.className = `canvas-stat${value > limit ? " invalid" : ratio >= 0.9 ? " warning" : ""}`;
    item.textContent = `${label}: ${value} / ${limit}`;
    item.title = t("editor.editorWorkspaceView.currentValueLimit", { 0: label, 1: value, 2: limit });
    return item;
  }
}
