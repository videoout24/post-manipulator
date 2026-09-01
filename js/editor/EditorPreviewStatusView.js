import { t } from "../i18n/index.js?v=1.8.0";
const PROJECT_BUSY_STATES = ["materializing", "updating", "resolving", "removing"];

export class EditorPreviewStatusView {
  constructor({ root, events = null, projectSession, notifications = null } = {}) {
    this.root = root;
    this.events = events;
    this.projectSession = projectSession;
    this.notifications = notifications;
    this.lastPreviewNotice = "";
    this.unsubscribers = [];
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("project:preview-sync", status => this.#handleProjectSync(status)),
      this.events?.on?.("telegram:preview-status", status => this.#handleTelegramPreview(status)),
      this.events?.on?.("telegram:live-preview-setting", ({ enabled }) => this.showLivePreviewSetting(enabled))
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  showProjectDeployment(project) {
    const deployed = (project?.posts || []).some(post => post.deployments?.preview?.messageId);
    this.showProject(
      deployed ? "synced" : "removed",
      deployed ? t("editor.editorPreviewStatusView.projectChannelStagingDeploymentExists") : t("editor.editorPreviewStatusView.projectChannelProjectNotYetUploaded")
    );
  }

  showProject(state, message = "") {
    if (!this.root) return;
    const normalized = state === "synced" ? "synced"
      : PROJECT_BUSY_STATES.includes(state) ? "syncing"
      : state === "waiting" ? "waiting"
      : state === "error" ? "error"
      : "idle";
    this.root.dataset.state = normalized;
    this.root.textContent = state === "synced" ? t("editor.editorPreviewStatusView.projectSynced")
      : PROJECT_BUSY_STATES.includes(state) ? t("editor.editorPreviewStatusView.projectSyncing")
      : state === "waiting" ? t("editor.editorPreviewStatusView.projectWaiting")
      : state === "error" ? t("editor.editorPreviewStatusView.projectError")
      : t("editor.editorPreviewStatusView.projectIdle");
    this.root.title = message || t("editor.editorPreviewStatusView.projectPreviewChannel");
  }

  showLivePreviewSetting(enabled) {
    if (!this.root || this.projectSession?.isProjectActive?.() || enabled) return;
    this.root.dataset.state = "idle";
    this.root.textContent = t("editor.editorPreviewStatusView.previewOff");
    this.root.title = t("editor.editorPreviewStatusView.telegramLivePreviewOff");
  }

  #handleProjectSync(status) {
    if (!this.projectSession?.isProjectActive?.() || status?.projectId !== this.projectSession.activeProjectId) return;
    const state = status?.state || "idle";
    const current = status?.current || 0;
    const total = status?.total || this.projectSession.project?.posts?.length || 0;
    const message = state === "synced" ? t("editor.editorPreviewStatusView.projectChannelSynchronized")
      : state === "materializing" ? t("editor.editorPreviewStatusView.projectChannelUploading", { 0: current, 1: total })
      : state === "updating" ? t("editor.editorPreviewStatusView.projectChannelSpotUpdate", { 0: current, 1: total })
      : state === "resolving" ? t("editor.editorPreviewStatusView.projectChannelUpdatingLinks", { 0: current, 1: total })
      : state === "removing" ? t("editor.editorPreviewStatusView.projectChannelDeleting", { 0: current, 1: total })
      : state === "removed" ? t("editor.editorPreviewStatusView.projectChannelUploadDeleted")
      : state === "remove-partial" ? t("editor.editorPreviewStatusView.projectChannelPartialDeletionRemaining", { 0: status?.remaining || 0 })
      : state === "waiting" ? t("editor.editorPreviewStatusView.projectChannelExpectingAValidAST")
      : state === "error" ? t("editor.editorPreviewStatusView.projectChannelError", { 0: status?.message || t("editor.editorPreviewStatusView.error") })
      : t("editor.editorPreviewStatusView.projectChannel");
    this.showProject(state, message);
  }

  #handleTelegramPreview(status) {
    if (this.projectSession?.isProjectActive?.()) return;
    const state = status?.state || "idle";
    const message = String(status?.message || "");
    if ((state === "error" || state === "unavailable") && message) {
      const key = `${state}:${message}`;
      if (key !== this.lastPreviewNotice) {
        this.lastPreviewNotice = key;
        this.notifications?.show?.({ message, type: "error", duration: 8000 });
      }
    } else if (state === "synced") {
      this.lastPreviewNotice = "";
    }
    if (!this.root) return;
    this.root.dataset.state = state;
    this.root.textContent = state === "synced" ? t("editor.editorPreviewStatusView.previewSynced")
      : state === "syncing" ? t("editor.editorPreviewStatusView.previewSyncing")
      : state === "waiting" || state === "invalid" ? t("editor.editorPreviewStatusView.previewWaiting")
      : state === "error" || state === "unavailable" ? t("editor.editorPreviewStatusView.previewError")
      : t("editor.editorPreviewStatusView.previewIdle");
    this.root.title = message || t("editor.editorPreviewStatusView.telegramLivePreview");
  }
}
