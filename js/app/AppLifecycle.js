import { t } from "../i18n/index.js?v=1.8.0";
export class AppLifecycle {
  constructor({
    windowRoot = window,
    documentRoot = document,
    build = "",
    notifications,
    layoutPreferences,
    telegramNavigation,
    projectSession,
    editorDocuments,
    editorTelegramControls,
    projectLibrary,
    galleryCore,
    telegramSettings,
    publicationView,
    galleryView,
    appDb,
    ownerBinding,
    previewChannelBinding,
    publicationTargets,
    publicationService,
    telegramRuntime,
    telegramClient,
    telegramCore,
    editorPreviewStatus,
    stoppables = [],
    logger = console
  } = {}) {
    Object.assign(this, {
      windowRoot, documentRoot, build, notifications, layoutPreferences,
      telegramNavigation, projectSession, editorDocuments, editorTelegramControls, projectLibrary,
      galleryCore, telegramSettings, publicationView, galleryView, appDb, ownerBinding,
      previewChannelBinding, publicationTargets, publicationService, telegramRuntime, telegramClient, telegramCore,
      editorPreviewStatus, stoppables, logger
    });
    this.stopped = false;
    this.onBeforeUnload = () => this.stop();
  }

  async start() {
    this.windowRoot?.addEventListener?.("beforeunload", this.onBeforeUnload);
    await this.#initialize("Layout", this.layoutPreferences);
    this.layoutPreferences?.bindSplitter?.(this.documentRoot.querySelector("#editorLeftSplitter"), { key: "editorLeft", edge: "left" });
    this.layoutPreferences?.bindSplitter?.(this.documentRoot.querySelector("#editorProjectSplitter"), { key: "editorProject", edge: "right" });
    this.layoutPreferences?.bindSplitter?.(this.documentRoot.querySelector("#projectLibrarySplitter"), { key: "projectLibraryLeft", edge: "left" });
    this.layoutPreferences?.bindSplitter?.(this.documentRoot.querySelector("#projectLibraryPostSplitter"), { key: "projectLibraryRight", edge: "right" });

    await this.#initialize("Telegram Navigation", this.telegramNavigation);
    await this.#initialize("Project Session", this.projectSession);
    await this.#initialize("Editor Document Context", this.editorDocuments);
    await this.#initialize("Editor Telegram Controls", this.editorTelegramControls);
    await this.#initialize("Project Library", this.projectLibrary);

    // Gallery must subscribe before polling starts, otherwise an initial pending
    // media update could be committed before its ingest handler exists.
    this.galleryCore?.start?.();
    await this.#initialize("Telegram Core", this.telegramSettings);
    await this.#initialize("Publications", this.publicationView);
    await this.#initialize("Draft schedules", this.publicationService);
    await this.#initialize("Gallery", this.galleryView);

    await this.#initializePreviewState();
    return this;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.windowRoot?.removeEventListener?.("beforeunload", this.onBeforeUnload);
    for (const service of this.stoppables) service?.stop?.();
    this.projectSession?.flush?.().catch?.(() => {});
    this.telegramRuntime?.stop?.();
    this.telegramClient?.clearToken?.();
    this.appDb?.close?.().catch?.(() => {});
  }

  async #initialize(name, service) {
    if (!service?.initialize) return true;
    try {
      await service.initialize();
      return true;
    } catch (error) {
      this.logger.error(`${name} initialization failed`, error);
      this.notifications?.show?.({ message: `${name}: ${error.message}`, type: "error" });
      if (name === "Gallery") this.#showGalleryError(error);
      return false;
    }
  }

  async #initializePreviewState() {
    try {
      const enabled = await this.telegramCore.editor.preview.isEnabled();
      this.editorPreviewStatus?.showLivePreviewSetting?.(enabled);
    } catch (error) {
      this.logger.error("Preview state initialization failed", error);
    }
  }

  #showGalleryError(error) {
    const root = this.documentRoot.querySelector("#galleryApp");
    if (!root) return;
    root.innerHTML = t("app.appLifecycle.galleryDidNotStartBuild", { 0: escapeHtml(error), 1: escapeHtml(this.build) });
  }
}

function escapeHtml(value) {
  return String(value?.message || value || t("app.appLifecycle.unknownError"))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
