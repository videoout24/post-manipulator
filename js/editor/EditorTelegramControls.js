import { t } from "../i18n/index.js?v=1.8.0";
const BUSY_STATES = new Set(["materializing", "updating", "resolving", "removing"]);

// Editor -> Telegram navigation is deliberately manual-only. Background autosave,
// Project selection and post switching may update staging, but never steal focus by
// opening Telegram. The only external navigation entry point here is manualButton.
export class EditorTelegramControls {
  constructor({
    manualButton,
    statusElement,
    deploymentButton,
    events,
    session,
    previewSync,
    livePreview = null,
    graphReconciler = null,
    navigation,
    onError = null,
    onToast = null
  } = {}) {
    this.manualButton = manualButton;
    this.statusElement = statusElement;
    this.deploymentButton = deploymentButton;
    this.events = events;
    this.session = session;
    this.previewSync = previewSync;
    this.livePreview = livePreview;
    this.graphReconciler = graphReconciler;
    this.navigation = navigation;
    this.onError = onError;
    this.onToast = onToast;
    this.syncState = null;
    this.lastNotice = null;
    this.livePreviewMessage = null;
    this.livePreviewEnabled = false;
    this.unsubscribers = [];
    this.bound = false;
  }

  async initialize() {
    this.#bind();
    this.unsubscribers.push(
      this.events?.on?.("project:session-changed", () => this.render()),
      this.events?.on?.("project:changed", event => {
        if (event?.projectId === this.session.activeProjectId) this.render();
      }),
      this.events?.on?.("project:preview-sync", status => {
        if (status?.projectId !== this.session.activeProjectId) return;
        this.syncState = status;
        const message = syncStatusLabel(status);
        if (message && !BUSY_STATES.has(status?.state)) {
          this.lastNotice = { message, type: syncStatusType(status?.state) };
        }
        this.render();
      }),
      this.events?.on?.("ui:notification-shown", notice => {
        const message = String(notice?.message || "").trim();
        if (!message) return;
        this.lastNotice = { message, type: notice?.type || "info" };
        this.render();
      }),
      this.events?.on?.("telegram:native-integration-setting", () => this.render()),
      this.events?.on?.("telegram:preview-status", status => {
        if (status?.preview) this.livePreviewMessage = status.preview;
        this.render();
      }),
      this.events?.on?.("telegram:live-preview-setting", ({ enabled }) => {
        this.livePreviewEnabled = Boolean(enabled);
        this.render();
      }),
      this.events?.on?.("telegram:preview-channel", channel => {
        if (channel?.status !== "bound") this.livePreviewMessage = null;
        this.#refreshLivePreview().catch(() => {});
      })
    );
    await this.#refreshLivePreview();
    this.render();
    return { manualOnly: true };
  }

  stop() { for (const off of this.unsubscribers.splice(0)) off?.(); }

  openCurrent() {
    const project = this.session.project;
    if (this.session.isProjectActive()) {
      const opened = this.navigation?.openProjectPost?.(project, this.session.activePostId, "preview") || false;
      if (!opened) this.onToast?.({ message: t("editor.editorTelegramControls.uploadTheProjectToThePreviewChannel"), type: "warning" });
      return opened;
    }
    const opened = this.livePreviewMessage
      ? (this.navigation?.openPrivateMessage?.(this.livePreviewMessage) || false)
      : false;
    if (!opened) this.onToast?.({ message: t("editor.editorTelegramControls.previewNotYetCreatedInTheChannel"), type: "warning" });
    return opened;
  }

  render() {
    const active = this.session.isProjectActive();
    const project = this.session.project;
    const deployed = hasPreviewDeployment(project);
    const relevantSyncState = this.syncState?.projectId === this.session.activeProjectId ? this.syncState : null;
    const busy = BUSY_STATES.has(relevantSyncState?.state);

    if (this.manualButton) {
      this.manualButton.hidden = false;
      this.manualButton.disabled = active ? !hasCurrentPostDeployment(this.session) : !this.livePreviewMessage?.messageId;
      this.manualButton.title = active
        ? (hasCurrentPostDeployment(this.session) ? t("editor.editorTelegramControls.openCurrentPreviewPostInTelegram") : t("editor.editorTelegramControls.firstUnloadTheProject"))
        : (this.livePreviewMessage?.messageId ? t("editor.editorTelegramControls.openPinnedLivePreviewInTelegram") : t("editor.editorTelegramControls.livePreviewHasNotYetBeenCreated"));
    }
    if (this.deploymentButton) {
      this.deploymentButton.hidden = !active;
      this.deploymentButton.disabled = !active || busy || !this.previewSync;
      this.deploymentButton.classList.toggle("danger-soft", deployed && !busy);
      this.deploymentButton.textContent = deployed ? t("editor.editorTelegramControls.deleteUpload") : t("editor.editorTelegramControls.unloadProject");
      this.deploymentButton.title = deployed
        ? t("editor.editorTelegramControls.deleteTelegramStagingDeploymentWhileKeepingLocal")
        : t("editor.editorTelegramControls.uploadAllProjectToPrivatePreviewChannel");
    }
    if (this.statusElement) {
      const busyStatus = busy ? syncStatusLabel(relevantSyncState) : "";
      const status = busyStatus || this.lastNotice?.message || syncStatusLabel(relevantSyncState) || t("editor.editorTelegramControls.done");
      const statusType = busyStatus ? "progress" : (this.lastNotice?.type || syncStatusType(relevantSyncState?.state));
      this.statusElement.hidden = false;
      this.statusElement.textContent = status;
      this.statusElement.dataset.state = busy ? relevantSyncState?.state : (statusType || "idle");
      this.statusElement.title = busyStatus ? (relevantSyncState?.message || status) : status;
    }
  }

  #bind() {
    if (this.bound) return;
    this.bound = true;
    this.manualButton?.addEventListener("click", () => this.openCurrent());
    this.deploymentButton?.addEventListener("click", () => this.#toggleDeployment());
  }

  async #refreshLivePreview() {
    if (!this.livePreview) return;
    const [enabled, message, channel] = await Promise.all([
      this.livePreview.isEnabled?.(),
      this.livePreview.getMessage?.(),
      this.livePreview.getChannel?.()
    ]);
    this.livePreviewEnabled = Boolean(enabled);
    this.livePreviewMessage = channel?.status === "bound" && Number(message?.chatId) === Number(channel.chatId) ? message : null;
    this.render();
  }

  async #toggleDeployment() {
    if (!this.session.isProjectActive() || !this.session.activeProjectId || !this.previewSync) return;
    const projectId = this.session.activeProjectId;
    const project = this.session.project;
    const deployed = hasPreviewDeployment(project);
    try {
      if (deployed) {
        const removal = await this.previewSync.remove(projectId);
        await this.session.refreshProject();
        if (removal?.partial) {
          this.onToast?.({
            message: t("editor.editorTelegramControls.uploadPartiallyDeletedTelegramProjectionsRemainYou", { 0: removal.remaining || removal.failed.length }),
            type: "warning"
          });
        } else {
          this.onToast?.({ message: t("editor.editorTelegramControls.projectUploadDeleted"), type: "success" });
        }
      } else {
        await this.session.flush();
        await this.graphReconciler?.reconcile?.(projectId);
        await this.session.refreshProject({ reloadActiveAst: true });
        await this.previewSync.sync(projectId);
        await this.session.refreshProject();
        this.onToast?.({ message: t("editor.editorTelegramControls.projectUploadedToPreviewChannel"), type: "success" });
      }
    } catch (error) {
      this.onError?.(error);
    } finally {
      this.render();
    }
  }
}

export function hasPreviewDeployment(project) {
  return (project?.posts || []).some(post => post.deployments?.preview?.messageId);
}

export function hasCurrentPostDeployment(session) {
  const post = session?.project?.posts?.find(item => String(item.id) === String(session.activePostId));
  return Boolean(post?.deployments?.preview?.messageId && post?.deployments?.preview?.chatId);
}

function busyLabel(status = {}) {
  const current = Number(status.current || 0);
  const total = Number(status.total || 0);
  if (status.state === "removing") return total ? t("editor.editorTelegramControls.delete", { 0: current, 1: total }) : t("core.cardDeleteConfirmation.deleting");
  if (status.state === "materializing") return total ? t("editor.editorTelegramControls.upload", { 0: current, 1: total }) : t("editor.editorTelegramControls.upload2");
  if (status.state === "updating") return total ? t("editor.editorTelegramControls.update", { 0: current, 1: total }) : t("editor.editorTelegramControls.update2");
  if (status.state === "resolving") return total ? t("editor.editorTelegramControls.links", { 0: current, 1: total }) : t("editor.editorTelegramControls.links2");
  return "Telegram…";
}

export function syncStatusLabel(status = null) {
  if (!status?.state) return "";
  if (BUSY_STATES.has(status.state)) return busyLabel(status);
  if (status.state === "synced") return t("editor.editorTelegramControls.synced");
  if (status.state === "waiting") return t("editor.editorTelegramControls.waitingForFixes");
  if (status.state === "removed") return t("editor.editorTelegramControls.uploadRemoved");
  if (status.state === "remove-partial") return t("editor.editorTelegramControls.partiallyDeleted");
  if (status.state === "error" || status.state === "cleanup-error") return t("editor.editorTelegramControls.syncError");
  return status.message || "";
}

function syncStatusType(state) {
  if (state === "synced" || state === "removed") return "success";
  if (state === "waiting" || state === "remove-partial") return "warning";
  if (state === "error" || state === "cleanup-error") return "error";
  return "info";
}
