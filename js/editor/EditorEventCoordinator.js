export class EditorEventCoordinator {
  constructor({
    events,
    projectSession,
    draftSession,
    telegramPreview,
    workspace,
    selection,
    textareaSizing = null,
    projectIndex,
    previewStatus
  } = {}) {
    Object.assign(this, {
      events, projectSession, draftSession, telegramPreview, workspace,
      selection, textareaSizing, projectIndex, previewStatus
    });
    this.unsubscribers = [];
    this.canvasSessionKey = null;
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("tree:changed", payload => this.#treeChanged(payload)),
      this.events?.on?.("project:session-changed", payload => this.#projectSessionChanged(payload)),
      this.events?.on?.("draft:session-changed", payload => this.#draftSessionChanged(payload)),
      this.events?.on?.("project:changed", payload => this.#projectChanged(payload)),
      this.events?.on?.("block-collector:changed", () => this.workspace?.updateCollectorState?.()),
      this.events?.on?.("selection:changed", () => this.workspace?.updateSelection?.())
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  #treeChanged(payload) {
    if (this.projectSession?.isProjectActive?.()) this.projectSession.scheduleAutosave();
    else if (this.draftSession?.isActive?.()) this.draftSession.scheduleAutosave();
    if (!this.projectSession?.isProjectActive?.() && payload?.affectsTelegram !== false) {
      this.telegramPreview?.schedule?.();
    }

    // Property editors already contain their current value. Rebuilding Canvas on
    // every keystroke would replace the active input and lose focus.
    if (payload?.source === "property") {
      this.workspace?.renderStats?.();
      this.workspace?.updateValidation?.();
    }
    else this.workspace?.render?.();
  }

  #projectSessionChanged({ project, activePostId = null, reason = "" } = {}) {
    this.selection?.clear?.();
    this.textareaSizing?.clear?.();
    this.projectIndex?.rebuild?.(project || null);
    this.workspace?.render?.();
    this.#resetScrollForSession(project?.id ? `project:${project.id}:${activePostId || ""}` : null, reason);

    if (!project) {
      this.telegramPreview?.schedule?.();
      return;
    }
    this.previewStatus?.showProjectDeployment?.(project);
  }

  #draftSessionChanged({ reason = "", activeDraftId = null } = {}) {
    // Opening a Draft activates its session after its AST has replaced the shared
    // tree. Re-render here so a no-context placeholder cannot remain on Canvas.
    this.workspace?.render?.();
    this.#resetScrollForSession(activeDraftId ? `draft:${activeDraftId}` : null, reason);
    if (!this.projectSession?.isProjectActive?.()) this.telegramPreview?.schedule?.();
  }

  #projectChanged({ projectId, project, reason } = {}) {
    if (projectId === this.projectSession?.activeProjectId && project && reason !== "deleted") {
      this.projectIndex?.rebuild?.(project);
    }
  }

  #resetScrollForSession(nextKey, reason = "") {
    const forceReload = ["opened", "recovered", "created", "created-from-first-block", "synced-from-channel"].includes(reason);
    if (nextKey && (nextKey !== this.canvasSessionKey || forceReload)) {
      this.workspace?.scrollCanvasToTop?.();
    }
    this.canvasSessionKey = nextKey;
  }
}
