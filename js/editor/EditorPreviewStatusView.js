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
      deployed ? "Project channel: staging deployment существует" : "Project channel: проект ещё не выгружен"
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
    this.root.textContent = state === "synced" ? "Project: ✓"
      : PROJECT_BUSY_STATES.includes(state) ? "Project: …"
      : state === "waiting" ? "Project: ◌"
      : state === "error" ? "Project: ×"
      : "Project: —";
    this.root.title = message || "Project preview channel";
  }

  showLivePreviewSetting(enabled) {
    if (!this.root || this.projectSession?.isProjectActive?.() || enabled) return;
    this.root.dataset.state = "idle";
    this.root.textContent = "Preview: выкл.";
    this.root.title = "Telegram live-preview выключен";
  }

  #handleProjectSync(status) {
    if (!this.projectSession?.isProjectActive?.() || status?.projectId !== this.projectSession.activeProjectId) return;
    const state = status?.state || "idle";
    const current = status?.current || 0;
    const total = status?.total || this.projectSession.project?.posts?.length || 0;
    const message = state === "synced" ? "Project channel: синхронизирован"
      : state === "materializing" ? `Project channel: выгрузка ${current}/${total}`
      : state === "updating" ? `Project channel: точечное обновление ${current}/${total}`
      : state === "resolving" ? `Project channel: обновление связей ${current}/${total}`
      : state === "removing" ? `Project channel: удаление ${current}/${total}`
      : state === "removed" ? "Project channel: выгрузка удалена"
      : state === "remove-partial" ? `Project channel: частичное удаление, осталось ${status?.remaining || 0}`
      : state === "waiting" ? "Project channel: ожидает валидного AST"
      : state === "error" ? `Project channel: ${status?.message || "ошибка"}`
      : "Project channel";
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
    this.root.textContent = state === "synced" ? "Preview: ✓"
      : state === "syncing" ? "Preview: …"
      : state === "waiting" || state === "invalid" ? "Preview: ◌"
      : state === "error" || state === "unavailable" ? "Preview: ×"
      : "Preview: —";
    this.root.title = message || "Telegram live-preview";
  }
}
