import { t } from "../i18n/index.js?v=1.8.0";
import { MetaBlockDialog } from "./MetaBlockDialog.js?v=1.6.5";
import { showDarkMessage } from "../core/DarkDialog.js?v=1.6.5";

export class EditorToolController {
  constructor({
    documentRoot = document,
    navigation,
    tree,
    controller,
    selection,
    validator,
    renderer,
    projectSession,
    buildPreviewTree,
    palette,
    workspace,
    notifications = null,
    metaRegistry = null,
    registry = null,
    metaDialog = null,
    metaDialogElement = null,
    openMetaButton = null,
    createMetaButton = null,
    blockSearch = null,
    openAssetPickerButton = null,
    jsonDialog = null,
    jsonOutput = null,
    dialogTitle = null,
    closeDialogButton = null,
    exportJsonButton = null,
    previewTelegramButton = null,
    alertFn = message => { void showDarkMessage({ message }); }
  } = {}) {
    Object.assign(this, {
      documentRoot, navigation, tree, controller, selection, validator, renderer,
      projectSession, buildPreviewTree, palette, workspace, notifications,
      blockSearch, openAssetPickerButton, jsonDialog, jsonOutput, dialogTitle,
      closeDialogButton, exportJsonButton, previewTelegramButton
    });
    this.alertFn = (...args) => Reflect.apply(alertFn, globalThis, args);
    this.metaDialog = metaDialog || (metaDialogElement ? new MetaBlockDialog({
      dialog: metaDialogElement,
      tree,
      controller,
      metaRegistry,
      registry,
      onCreated: definition => {
        palette?.render?.();
        controller?.select?.(null);
        this.alertFn(t("editor.editorToolController.createdMetaBlock", { 0: definition.name }));
      }
    }) : null);
    this.openMetaButton = openMetaButton;
    this.createMetaButton = createMetaButton;
    this.unsubscribers = [];
  }

  start() {
    this.#listen(this.openAssetPickerButton, "click", () => this.workspace?.showAssetPicker?.());
    this.#listen(this.blockSearch, "input", event => {
      this.palette.search = event.target.value;
      this.palette.render();
    });
    this.#listen(this.documentRoot, "keydown", event => this.handleKeydown(event));
    this.#listen(this.openMetaButton, "click", () => this.metaDialog?.open?.());
    this.#listen(this.createMetaButton, "click", event => {
      event.preventDefault();
      try { this.metaDialog?.create?.(); }
      catch (error) { this.alertFn(error.message); }
    });
    this.#listen(this.closeDialogButton, "click", () => this.jsonDialog?.close?.());
    this.#listen(this.exportJsonButton, "click", () => this.exportJson());
    this.#listen(this.previewTelegramButton, "click", () => this.previewTelegram());
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  handleKeydown(event) {
    if (event.key !== "Delete" || event.defaultPrevented || this.navigation?.activeTab !== "editor") return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (isEditingTarget(event.target) || this.documentRoot.querySelector?.("dialog[open]")) return false;
    const selected = this.selection?.all?.() || [];
    if (!selected.length) return false;
    event.preventDefault();
    this.controller.removeSelected();
    this.notifications?.show?.({
      message: selected.length === 1 ? t("editor.editorToolController.blockDeleted") : t("editor.editorToolController.blocksRemoved", { 0: selected.length }),
      type: "info"
    });
    return true;
  }

  exportJson() {
    if (this.dialogTitle) this.dialogTitle.textContent = t("editor.editorToolController.internalAst");
    if (this.jsonOutput) this.jsonOutput.textContent = JSON.stringify(this.tree.toJSON(), null, 2);
    this.jsonDialog?.showModal?.();
  }

  previewTelegram() {
    if (this.dialogTitle) {
      this.dialogTitle.textContent = this.projectSession?.isProjectActive?.()
        ? "Telegram Rich Message · compiled Project post"
        : t("editor.editorToolController.telegramRichMessage");
    }
    try {
      const previewTree = this.buildPreviewTree();
      const errors = this.validator.validate(previewTree);
      const result = this.renderer.renderEnvelope(previewTree);
      if (this.jsonOutput) this.jsonOutput.textContent = JSON.stringify({
        valid: errors.length === 0,
        source: this.projectSession?.isProjectActive?.() ? "project-compiled" : "standalone",
        stats: this.validator.stats(previewTree),
        errors,
        rich_message: result.richMessage,
        reply_markup: result.replyMarkup
      }, null, 2);
    } catch (error) {
      if (this.jsonOutput) this.jsonOutput.textContent = JSON.stringify({ valid: false, error: error?.message || String(error) }, null, 2);
    }
    this.jsonDialog?.showModal?.();
  }

  #listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    this.unsubscribers.push(() => target.removeEventListener(name, handler));
  }
}

function isEditingTarget(target) {
  if (!target || typeof target.closest !== "function") return Boolean(target?.isContentEditable);
  if (target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='plaintext-only']")) return true;
  return Boolean(target.isContentEditable);
}
