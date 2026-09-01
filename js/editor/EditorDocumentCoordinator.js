import { t } from "../i18n/index.js?v=1.8.0";
export class EditorDocumentCoordinator {
  constructor({ projectSession, draftSession, drafts, projects, graphReconciler = null, tree = null, storage = null } = {}) {
    this.projectSession = projectSession;
    this.draftSession = draftSession;
    this.drafts = drafts;
    this.projects = projects;
    this.graphReconciler = graphReconciler;
    this.tree = tree;
    this.storage = storage;
  }

  async initialize() {
    // Earlier versions restored a nameless standalone Canvas from local storage.
    // Adopt it once as a real Draft so no user content is discarded while every
    // editable Canvas thereafter has a document context.
    if (this.projectSession?.isProjectActive?.() || this.draftSession?.isActive?.()) return null;
    const ast = this.tree?.toJSON?.();
    if (!ast?.children?.length) {
      this.storage?.clear?.();
      return null;
    }
    const draft = await this.drafts.create({
      title: t("editor.editorDocumentCoordinator.restoredDraft"),
      messageAst: ast,
      source: { kind: "draft" }
    });
    await this.projectSession.openStandaloneAst(draft.messageAst, { reason: "standalone-recovered", persist: false });
    this.draftSession?.activate?.(draft, { reason: "recovered" });
    return draft;
  }

  async saveCurrentContext() {
    if (this.projectSession?.isProjectActive?.()) {
      await this.projectSession.flush();
      return "project";
    }
    if (this.draftSession?.isActive?.()) {
      await this.draftSession.flush();
      return "draft";
    }
    return "none";
  }

  async openDraft(draftId) {
    await this.saveCurrentContext();
    const draft = await this.drafts.get(draftId);
    if (!draft) throw new Error(t("editor.editorDocumentCoordinator.draftNotFound", { 0: draftId }));
    await this.projectSession.openStandaloneAst(draft.messageAst, { reason: "draft-opened", persist: false });
    this.draftSession?.activate?.(draft, { reason: "opened" });
    return draft;
  }

  async openProjectPost(projectId, postId) {
    if (!projectId || !postId) throw new Error(t("editor.editorDocumentCoordinator.projectPostNotSpecified"));
    await this.saveCurrentContext();
    if (this.draftSession?.isActive?.()) {
      await this.draftSession.deactivate({ flush: false, reason: "project-opened" });
    }
    await this.projectSession.openProject(projectId, { postId, reason: "link-opened" });
    await this.projectSession.refreshProject({ reloadActiveAst: true });
    return this.projectSession.snapshot?.() || { projectId, postId };
  }

  async moveDraftToProject(draftId, projectId) {
    await this.saveCurrentContext();
    const draft = await this.drafts.get(draftId);
    if (!draft) throw new Error(t("editor.editorDocumentCoordinator.draftNotFound", { 0: draftId }));
    const { post } = await this.projects.createPost(projectId, {
      title: draft.title || t("editor.blockInspector.post"),
      messageAst: draft.messageAst
    });
    await this.graphReconciler?.reconcile?.(projectId);
    await this.drafts.delete(draft.id);

    if (this.draftSession?.isActive?.()) {
      await this.draftSession.deactivate({ flush: false, reason: "project-opened" });
    }
    await this.projectSession.openProject(projectId, { postId: post.id, reason: "draft-moved-to-project" });
    await this.projectSession.refreshProject({ reloadActiveAst: true });
    return { draft, post };
  }

  async clearPublishedDraft(draftId) {
    return this.#clearRemovedDraft(draftId, { sessionReason: "published", canvasReason: "draft-published" });
  }

  async clearScheduledDraft(draftId) {
    return this.#clearRemovedDraft(draftId, { sessionReason: "scheduled", canvasReason: "draft-scheduled" });
  }

  async #clearRemovedDraft(draftId, { sessionReason, canvasReason }) {
    if (this.projectSession?.isProjectActive?.()) return false;
    const activeDraftId = this.draftSession?.activeDraftId || null;
    if (activeDraftId && activeDraftId !== draftId) return false;
    if (activeDraftId === draftId) await this.draftSession.deactivate({ flush: false, reason: sessionReason });
    await this.projectSession.openStandaloneAst(
      { id: "root", type: "document", props: {}, children: [] },
      { reason: canvasReason, persist: false }
    );
    return true;
  }

  async discardDraft(draftId, { reason = "discarded" } = {}) {
    if (this.projectSession?.isProjectActive?.()) return false;
    if (this.draftSession?.activeDraftId !== draftId) return false;
    await this.draftSession.deactivate({ flush: false, reason });
    await this.drafts.delete(draftId);
    await this.projectSession.openStandaloneAst(
      { id: "root", type: "document", props: {}, children: [] },
      { reason, persist: false }
    );
    return true;
  }
}
