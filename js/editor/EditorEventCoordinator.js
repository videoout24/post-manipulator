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
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("tree:changed", payload => this.#treeChanged(payload)),
      this.events?.on?.("project:session-changed", payload => this.#projectSessionChanged(payload)),
      this.events?.on?.("draft:session-changed", () => this.#draftSessionChanged()),
      this.events?.on?.("project:changed", payload => this.#projectChanged(payload)),
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
    if (!this.projectSession?.isProjectActive?.()) this.telegramPreview?.schedule?.();

    // Property editors already contain their current value. Rebuilding Canvas on
    // every keystroke would replace the active input and lose focus.
    if (payload?.source === "property") {
      this.workspace?.renderStats?.();
      this.workspace?.updateValidation?.();
    }
    else this.workspace?.render?.();
  }

  #projectSessionChanged({ project } = {}) {
    this.selection?.clear?.();
    this.textareaSizing?.clear?.();
    this.projectIndex?.rebuild?.(project || null);
    this.workspace?.render?.();

    if (!project) {
      this.telegramPreview?.schedule?.();
      return;
    }
    this.previewStatus?.showProjectDeployment?.(project);
  }

  #draftSessionChanged() {
    // Opening a Draft activates its session after its AST has replaced the shared
    // tree. Re-render here so a no-context placeholder cannot remain on Canvas.
    this.workspace?.render?.();
    if (!this.projectSession?.isProjectActive?.()) this.telegramPreview?.schedule?.();
  }

  #projectChanged({ projectId, project, reason } = {}) {
    if (projectId === this.projectSession?.activeProjectId && project && reason !== "deleted") {
      this.projectIndex?.rebuild?.(project);
    }
  }
}
