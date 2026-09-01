import { getLocale, t } from "../i18n/index.js?v=1.8.0";
export class EditorCommandController {
  constructor({
    newButton = null,
    openDraftsButton = null,
    projectSession,
    draftSession,
    draftStore,
    documents,
    tree,
    controller = null,
    selection = null,
    textareaSizing = null,
    rightPanel,
    workspace = null,
    events = null,
    notifications = null,
    promptFn = null,
    requestDraftTitleFn = null,
    now = () => new Date()
  } = {}) {
    this.newButton = newButton;
    this.openDraftsButton = openDraftsButton;
    this.projectSession = projectSession;
    this.draftSession = draftSession;
    this.draftStore = draftStore;
    this.documents = documents;
    this.tree = tree;
    this.controller = controller;
    this.selection = selection;
    this.textareaSizing = textareaSizing;
    this.rightPanel = rightPanel;
    this.workspace = workspace;
    this.events = events;
    this.notifications = notifications;
    this.requestDraftTitleFn = requestDraftTitleFn
      ? options => Reflect.apply(requestDraftTitleFn, globalThis, [options])
      : promptFn
        ? ({ prompt, defaultTitle }) => Reflect.apply(promptFn, globalThis, [prompt, defaultTitle])
        : requestDraftTitle;
    this.now = now;
    this.unsubscribers = [];
    this.pendingDraftBlockRequest = null;
  }

  start() {
    this.#listen(this.newButton, "click", () => this.runPrimaryDraftAction());
    this.#listen(this.openDraftsButton, "click", () => this.rightPanel?.toggleDrafts?.());
    this.unsubscribers.push(
      this.events?.on?.("project:session-changed", () => this.updateDocumentControls()),
      this.events?.on?.("draft:session-changed", () => {
        this.updateDocumentControls();
        this.workspace?.renderLeftPanel?.();
      }),
      this.events?.on?.("tree:changed", () => this.updateDocumentControls()),
      this.events?.on?.("editor:draft-create-requested", request => this.requestDraftForBlock(request)),
      this.events?.on?.("editor:right-panel-mode", ({ mode }) => this.updateDraftsButton(mode))
    );
    this.updateDocumentControls();
    this.updateDraftsButton();
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  updateDocumentControls() {
    const projectActive = this.projectSession?.isProjectActive?.();
    const hasContent = (this.tree?.root?.children || this.tree?.toJSON?.()?.children || []).length > 0;
    if (this.newButton) {
      const saveProjectCopy = projectActive && hasContent;
      this.newButton.textContent = saveProjectCopy ? t("editor.editorCommandController.saveAsDraft") : t("editor.editorCommandController.newDraft");
      this.newButton.title = saveProjectCopy
        ? t("editor.editorCommandController.createASeparateDraftFromTheCurrent")
        : t("editor.editorCommandController.createANewDraftWithAutomaticSaving");
      this.newButton.dataset.action = saveProjectCopy ? "save-as-draft" : "new-draft";
    }
  }

  runPrimaryDraftAction() {
    return this.newButton?.dataset?.action === "save-as-draft" ? this.saveDraft() : this.createDraft();
  }

  updateDraftsButton(mode = this.rightPanel?.getMode?.()) {
    if (!this.openDraftsButton) return;
    const active = mode === "drafts";
    const lockedOpen = active && !this.projectSession?.isProjectActive?.();
    this.openDraftsButton.classList.toggle("active", active);
    this.openDraftsButton.disabled = lockedOpen;
    this.openDraftsButton.setAttribute("aria-pressed", String(active));
    this.openDraftsButton.title = active
      ? (this.projectSession?.isProjectActive?.() ? t("editor.editorCommandController.returnToProjectPosts") : t("editor.editorCommandController.draftPanelOpened"))
      : t("editor.editorCommandController.showLocalDrafts");
  }

  async saveDocument() {
    return this.#run(async () => {
      if (this.projectSession.isProjectActive()) {
        await this.projectSession.saveNow();
        this.#toast({ message: t("editor.editorCommandController.projectPostSaved"), type: "success" });
      } else if (this.draftSession.isActive()) {
        await this.draftSession.saveNow();
        this.#toast({ message: t("editor.editorCommandController.draftSaved", { 0: this.draftSession.draft?.title || t("editor.draftListView.draft") }), type: "success" });
      } else {
        throw new Error(t("editor.editorCommandController.openOrCreateADraft"));
      }
    });
  }

  async createDraft() {
    const messageAst = this.#hasDocumentContext()
      ? emptyDocument()
      : (this.tree?.toJSON?.() || emptyDocument());
    return this.#run(() => this.#createDraft({ messageAst }));
  }

  async requestDraftForBlock({ type, parentId = "root", index = Infinity, options = {} } = {}) {
    if (!type) return null;
    if (this.pendingDraftBlockRequest) return this.pendingDraftBlockRequest;

    const task = this.#run(async () => {
      if (!this.#hasDocumentContext()) {
        // Preserve any legacy scratch AST while it is being adopted as the first
        // named Draft. In the normal no-context state this is simply an empty AST.
        const draft = await this.#createDraft({
          messageAst: this.tree?.toJSON?.() || emptyDocument(),
          reason: "first-block-draft"
        });
        if (!draft) return null;
      }
      return this.controller?.addBlock?.(type, parentId, index, options) || null;
    }, t("editor.draftListView.draft"));
    this.pendingDraftBlockRequest = task;
    try { return await task; }
    finally { this.pendingDraftBlockRequest = null; }
  }

  async saveDraft() {
    return this.#run(async () => {
      if (this.draftSession.isActive() && !this.projectSession.isProjectActive()) {
        await this.draftSession.saveNow();
        this.#toast({ message: t("editor.editorCommandController.draftSaved", { 0: this.draftSession.draft?.title || t("editor.draftListView.draft") }), type: "success" });
        return this.draftSession.draft;
      }

      await this.documents.saveCurrentContext();
      const state = this.projectSession.snapshot();
      const activePost = state.project?.posts?.find(post => post.id === state.activePostId) || null;
      if (!activePost) throw new Error(t("editor.editorCommandController.openAProjectPostOrCreateA"));
      const defaultTitle = activePost
        ? `${state.project?.title || t("project.projectLibraryView.project")} — ${activePost.title || t("editor.blockInspector.post")}`
        : t("editor.editorCommandController.draft", { 0: formatTime(this.now()) });
      const title = await this.requestDraftTitleFn({
        mode: "save-copy",
        prompt: t("editor.draftListView.draftTitle"),
        defaultTitle
      });
      if (title === null) return null;
      const source = {
        kind: "project",
        projectId: state.activeProjectId,
        projectTitle: state.project?.title || "",
        postId: activePost.id,
        postTitle: activePost.title || ""
      };
      const draft = await this.draftStore.create({
        title: title.trim() || defaultTitle,
        messageAst: this.tree.toJSON(),
        source
      });
      this.#toast({ message: t("editor.editorCommandController.draftSaved", { 0: draft.title }), type: "success" });
      return draft;
    }, t("editor.draftListView.draft"));
  }

  async #createDraft({ messageAst = emptyDocument(), reason = "new-draft" } = {}) {
    await this.documents?.saveCurrentContext?.();
    const defaultTitle = t("editor.editorCommandController.draft", { 0: formatTime(this.now()) });
    const title = await this.requestDraftTitleFn({
      mode: "create",
      prompt: t("editor.editorCommandController.newDraftTitle"),
      defaultTitle
    });
    if (title === null) return null;

    if (this.draftSession.isActive()) await this.draftSession.deactivate({ flush: false, reason: "new-draft" });
    const draft = await this.draftStore.create({
      title: title.trim() || t("editor.draftListView.draft"),
      messageAst: structuredClone(messageAst),
      source: { kind: "draft" }
    });
    await this.projectSession.openStandaloneAst(draft.messageAst, { reason, persist: false });
    this.draftSession.activate(draft, { reason: reason === "first-block-draft" ? "created-from-first-block" : "created" });
    this.selection?.clear?.();
    this.textareaSizing?.clear?.();
    this.rightPanel?.showDrafts?.();
    this.workspace?.render?.();
    this.#toast({ message: t("editor.editorCommandController.draftCreated", { 0: draft.title }), type: "success" });
    return draft;
  }

  #hasDocumentContext() {
    return Boolean(this.projectSession?.isProjectActive?.() || this.draftSession?.isActive?.());
  }

  async #run(action, prefix = "") {
    try { return await action(); }
    catch (error) {
      const message = error?.message || String(error);
      this.#toast({ message: prefix ? `${prefix}: ${message}` : message, type: "error" });
      return null;
    }
  }

  #toast(payload) { this.notifications?.show?.(payload); }

  #listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    this.unsubscribers.push(() => target.removeEventListener(name, handler));
  }
}

function formatTime(date) {
  return date.toLocaleString(getLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function emptyDocument() {
  return { id: "root", type: "document", props: {}, children: [] };
}

function requestDraftTitle({ mode = "create", defaultTitle = t("editor.draftListView.draft") } = {}) {
  return new Promise(resolve => {
    const savingCopy = mode === "save-copy";
    const dialog = document.createElement("dialog");
    dialog.className = "draft-create-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = element("div", "dialog-head");
    head.append(element("strong", "", savingCopy ? t("editor.editorCommandController.saveAsDraft") : t("editor.editorCommandController.newDraft")));
    head.append(dialogButton("×", () => dialog.close("cancel")));
    const body = element("div", "draft-create-dialog-body");
    const field = element("label", "draft-create-dialog-field");
    field.append(element("span", "", t("editor.draftListView.draftTitle")));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 160;
    input.value = defaultTitle;
    input.setAttribute("aria-label", t("editor.draftListView.draftTitle"));
    field.append(input);
    const error = element("div", "draft-create-dialog-error");
    const actions = element("div", "format-config-actions");
    const cancel = dialogButton(t("core.cardDeleteConfirmation.cancel"), () => dialog.close("cancel"));
    const submit = dialogButton(savingCopy ? t("core.darkDialog.save") : t("editor.editorCommandController.create"), () => {
      if (!input.value.trim()) {
        error.textContent = t("editor.editorCommandController.enterDraftTitle");
        input.classList.add("invalid");
        input.focus();
        return;
      }
      dialog.close("submit");
    }, "primary");
    input.oninput = () => {
      input.classList.remove("invalid");
      error.textContent = "";
    };
    input.onkeydown = event => {
      if (event.key === "Enter") { event.preventDefault(); submit.click(); }
    };
    actions.append(cancel, submit);
    body.append(field, error, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const title = dialog.returnValue === "submit" ? input.value.trim() : null;
      dialog.remove();
      resolve(title);
    }, { once: true });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function dialogButton(label, handler, className = "") {
  const item = element("button", className, label);
  item.type = "button";
  item.onclick = handler;
  return item;
}
