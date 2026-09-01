import { createDraftListView } from "./DraftListView.js?v=1.7.12";
import { createProjectPostListView } from "./ProjectPostListView.js?v=1.7.12";

export class EditorRightPanel {
  constructor({
    root, layout, session, draftSession = null, drafts, projects = null,
    documents = null, events, onError = null, onToast = null, onPublishDraft = null, onApplyDraftChanges = null,
    onPublishProjectPost = null, onScheduleProjectPost = null, onCancelProjectPostSchedule = null, onApplyProjectChanges = null
  } = {}) {
    this.root = root;
    this.layout = layout;
    this.session = session;
    this.draftSession = draftSession;
    this.drafts = drafts;
    this.projects = projects;
    this.documents = documents;
    this.events = events;
    this.onError = onError;
    this.onToast = onToast;
    this.onPublishDraft = onPublishDraft;
    this.onApplyDraftChanges = onApplyDraftChanges;
    this.onPublishProjectPost = onPublishProjectPost;
    this.onScheduleProjectPost = onScheduleProjectPost;
    this.onCancelProjectPostSchedule = onCancelProjectPostSchedule;
    this.onApplyProjectChanges = onApplyProjectChanges;
    // Outside a Project the editor lives in the Drafts context, even before a
    // particular Draft is selected on Canvas.
    this.mode = session?.isProjectActive?.() ? "project" : "drafts";
    this.linkTargetSlotKey = "";
    this.linkedTargets = {};
    this.unsubscribers = [];
    this.renderRevision = 0;
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("project:session-changed", ({ project }) => {
        // Project context always wins. Opening a Project from the library must replace
        // a previously visible Draft panel immediately.
        if (project) this.mode = "project";
        else this.mode = "drafts";
        this.render();
        this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
      }),
      this.events?.on?.("project:changed", event => {
        if (this.mode === "project" && event?.projectId === this.session.activeProjectId) this.render();
      }),
      this.events?.on?.("draft:changed", () => {
        if (this.mode === "drafts") this.render();
      }),
      this.events?.on?.("draft:session-changed", ({ activeDraftId }) => {
        if (activeDraftId && !this.session?.isProjectActive?.()) this.mode = "drafts";
        this.render();
        this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
      }),
      this.events?.on?.("links:target-slot-changed", ({ targetKey = "" } = {}) => {
        if (targetKey === this.linkTargetSlotKey) return;
        this.linkTargetSlotKey = targetKey;
        this.render();
      }),
      this.events?.on?.("links:relation-targets-changed", ({ linkedTargets = {} } = {}) => {
        this.linkedTargets = linkedTargets;
        this.render();
      }),
      this.events?.on?.("publication:edit-draft-requested", draft => this.#run(() => this.#loadDraft(draft)))
    );
    this.events?.emit?.("links:state-requested");
    this.render();
  }

  stop() { for (const off of this.unsubscribers.splice(0)) off?.(); }
  getMode() { return this.mode; }

  showDrafts() {
    this.mode = "drafts";
    this.render();
    this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
  }

  showProject() {
    this.mode = this.session?.isProjectActive?.() ? "project" : "drafts";
    this.render();
    this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
  }

  toggleDrafts() {
    if (this.mode === "drafts") this.showProject();
    else this.showDrafts();
  }

  close() {
    this.mode = this.session?.isProjectActive?.() ? "none" : "drafts";
    this.render();
    this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
  }

  async render() {
    if (!this.root || !this.layout) return;
    const revision = ++this.renderRevision;
    const show = this.mode === "drafts" || (this.mode === "project" && this.session?.isProjectActive?.());
    this.root.hidden = !show;
    this.layout.classList.toggle("project-active", show);
    const splitter = this.layout.querySelector("#editorProjectSplitter");
    if (splitter) splitter.hidden = !show;
    if (!show) {
      this.root.innerHTML = "";
      return;
    }
    if (this.mode === "drafts") await this.#renderDrafts(revision);
    else this.#renderProject();
  }

  #renderProject() {
    const state = this.session.snapshot();
    const project = state.project;
    if (!project) return this.close();
    this.root.replaceChildren(createProjectPostListView({
      project,
      activePostId: state.activePostId,
      onClose: () => this.#run(() => this.session.closeProject()),
      onSelect: post => this.#run(() => this.session.openPost(post.id)),
      onSelectTarget: target => this.#selectLinkTarget(target),
      onOpenLinkedSource: target => this.#openLinkedSource(target),
      linkTargetSlotKey: this.linkTargetSlotKey,
      linkedTargets: this.linkedTargets,
      onRename: (post, title) => this.#renamePost(post, title),
      onPublish: post => this.#publishProjectPost(post),
      onSchedule: post => this.#scheduleProjectPost(post),
      onCancelSchedule: post => this.#cancelProjectPostSchedule(post),
      onApplyChanges: post => this.#applyProjectChanges(post),
      onDelete: post => this.#deleteProjectPost(post)
    }));
  }

  async #renderDrafts(revision) {
    let rows = await this.drafts?.list?.() || [];
    const activeDraft = rows.find(draft => draft.id === this.draftSession?.activeDraftId);
    if (activeDraft?.source?.kind === "publication") rows = [activeDraft];
    // Events may request another render while persistent storage is resolving this
    // one. Only the newest result may commit DOM; otherwise both results append
    // identical Draft lists.
    if (revision !== this.renderRevision || this.mode !== "drafts") return;

    const fragment = createDraftListView({
      drafts: rows,
      activeDraftId: this.draftSession?.activeDraftId,
      onClose: () => this.showProject(),
      onOpen: draft => this.#run(() => this.#loadDraft(draft)),
      onRename: (draft, title) => this.#renameDraft(draft, title),
      onDelete: draft => this.#deleteDraft(draft),
      onMoveToProject: draft => this.#moveDraftToProject(draft),
      onPublish: draft => this.#requestDraftPublication(draft),
      onApplyChanges: draft => this.#applyDraftChanges(draft),
      onCancelPublicationEdit: draft => this.#cancelPublicationEdit(draft),
      onSelectTarget: target => this.#selectLinkTarget(target),
      onOpenLinkedSource: target => this.#openLinkedSource(target),
      linkTargetSlotKey: this.linkTargetSlotKey,
      linkedTargets: this.linkedTargets
    });
    this.root.replaceChildren(fragment);
  }

  async #loadDraft(draft) {
    const fresh = await this.documents.openDraft(draft.id);
    this.mode = "drafts";
    this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
    this.onToast?.({ message: `Черновик открыт: ${fresh.title}`, type: "success" });
  }

  #selectLinkTarget(target) {
    this.events?.emit?.("links:target-selected", target);
  }

  #openLinkedSource(target) {
    this.events?.emit?.("links:open-linked-source-requested", target);
  }

  async #requestDraftPublication(draft) {
    return this.#run(async () => {
      await this.documents?.saveCurrentContext?.();
      const fresh = await this.drafts?.get?.(draft.id);
      if (!fresh) throw new Error("Черновик не найден");
      if (!fresh.messageAst?.children?.length) throw new Error("Добавьте хотя бы один блок перед публикацией");
      if (this.onPublishDraft) return this.onPublishDraft(fresh);
      this.events?.emit?.("publication:draft-requested", fresh);
      return true;
    });
  }

  async #applyDraftChanges(draft) {
    return this.#run(async () => {
      await this.documents?.saveCurrentContext?.();
      const record = await this.onApplyDraftChanges?.(draft.id);
      if (!record) return record;
      const discarded = await this.#finishPublicationEdit(draft, "publication-edit-applied");
      if (!discarded) throw new Error("Публикация обновлена, но не удалось очистить редактор");
      this.onToast?.({ message: `Публикация обновлена: ${record.source?.title || draft.title}`, type: "success" });
      return record;
    });
  }

  async #applyProjectChanges(post) {
    return this.#run(async () => {
      if (!this.session?.activeProjectId || !post?.id) throw new Error("Project post не выбран");
      const result = await this.onApplyProjectChanges?.(this.session.activeProjectId, post.id);
      if (!result) return result;
      this.onToast?.({ message: `Изменения применены: ${post.title || "Пост"}`, type: "success" });
      return result;
    });
  }

  async #publishProjectPost(post) {
    return this.#run(async () => {
      if (!this.session?.activeProjectId || !post?.id) throw new Error("Project post не выбран");
      const project = this.session.snapshot?.().project;
      const result = await this.onPublishProjectPost?.(project, post);
      return result;
    });
  }

  async #scheduleProjectPost(post) {
    return this.#run(async () => {
      if (!this.session?.activeProjectId || !post?.id) throw new Error("Project post не выбран");
      const project = this.session.snapshot?.().project;
      return this.onScheduleProjectPost?.(project, post);
    });
  }

  async #cancelProjectPostSchedule(post) {
    return this.#run(async () => {
      if (!this.session?.activeProjectId || !post?.id) throw new Error("Project post не выбран");
      const result = await this.onCancelProjectPostSchedule?.(this.session.activeProjectId, post.id);
      if (result) this.onToast?.({ message: `Отложенная публикация отменена: ${post.title || "Пост"}`, type: "success" });
      return result;
    });
  }

  async #cancelPublicationEdit(draft) {
    return this.#run(async () => {
      const discarded = await this.#finishPublicationEdit(draft, "publication-edit-cancelled");
      if (!discarded) throw new Error("Не удалось закрыть редактирование публикации");
      this.onToast?.({ message: "Редактирование публикации отменено", type: "info" });
      return true;
    });
  }

  async #finishPublicationEdit(draft, reason) {
    const discarded = await this.documents?.discardDraft?.(draft.id, { reason });
    if (!discarded) return false;
    this.mode = "drafts";
    await this.render();
    this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
    return true;
  }

  async #renameDraft(draft, title) {
    return this.#run(() => this.drafts.rename(draft.id, title));
  }

  async #deleteDraft(draft) {
    return this.#run(async () => {
      const active = this.draftSession?.activeDraftId === draft.id;
      if (active && this.documents?.discardDraft) {
        const discarded = await this.documents.discardDraft(draft.id, { reason: "deleted" });
        if (!discarded) throw new Error("Не удалось закрыть черновик");
      } else {
        if (active) await this.draftSession.deactivate({ flush: false, reason: "deleted" });
        await this.drafts.delete(draft.id);
      }
      this.mode = "drafts";
      return true;
    });
  }

  async #moveDraftToProject(draft) {
    const projects = await this.projects?.listProjects?.() || [];
    if (!projects.length) {
      this.onToast?.({ message: "Сначала создайте Project", type: "warning" });
      return;
    }
    const projectId = await chooseProject(projects, this.session?.activeProjectId || null);
    if (!projectId) return;

    await this.#run(async () => {
      const { draft: fresh } = await this.documents.moveDraftToProject(draft.id, projectId);
      this.mode = "project";
      await this.render();
      this.events?.emit?.("editor:right-panel-mode", { mode: this.mode });
      this.onToast?.({ message: `Черновик перенесён в Project: ${fresh.title}`, type: "success" });
    });
  }

  async #renamePost(post, title) {
    return this.#run(() => this.session.renamePost(post.id, title));
  }

  async #deleteProjectPost(post) {
    const result = await this.#run(() => this.session.deletePost(post.id));
    return Boolean(result);
  }

  async #run(action) {
    try { return await action(); }
    catch (error) { this.onError?.(error); return null; }
  }
}

function chooseProject(projects, preferredId = null) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "draft-project-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    head.append(el("strong", "", "Перенести черновик в Project"));
    const close = button("×", "Закрыть", () => dialog.close("cancel"));
    head.append(close);

    const body = el("div", "draft-project-dialog-body");
    const label = el("label", "draft-project-select-field");
    label.append(el("span", "", "Project"));
    const select = document.createElement("select");
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.title} · ${project.posts?.length || 0} постов`;
      if (project.id === preferredId) option.selected = true;
      select.append(option);
    }
    label.append(select);
    const actions = el("div", "format-config-actions");
    actions.append(
      button("Отмена", "Отмена", () => dialog.close("cancel")),
      button("В проект", "Перенести", () => dialog.close("move"))
    );
    actions.lastElementChild?.classList.add("primary");
    body.append(label, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue === "move" ? select.value : null;
      dialog.remove();
      resolve(value);
    }, { once: true });
    dialog.showModal();
  });
}

function button(text, title, handler) {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  item.title = title;
  item.onclick = event => { event.stopPropagation(); handler?.(event); };
  return item;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}
