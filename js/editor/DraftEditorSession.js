export class DraftEditorSession {
  constructor({ store, tree, events = null, autosaveDelay = 250 } = {}) {
    this.store = store;
    this.tree = tree;
    this.events = events;
    this.autosaveDelay = autosaveDelay;
    this.activeDraftId = null;
    this.draft = null;
    this.timer = null;
    this.pendingSave = null;
    this.editVersion = 0;
    this.savedVersion = 0;

    this.unsubscribe = this.events?.on?.("draft:changed", event => {
      if (!this.activeDraftId || event?.draftId !== this.activeDraftId) return;
      if (event.reason === "deleted") {
        this.activeDraftId = null;
        this.draft = null;
        this.#emit("deleted");
        return;
      }
      if (event?.draft) this.draft = structuredClone(event.draft);
    });
  }

  isActive() { return Boolean(this.activeDraftId); }
  snapshot() {
    return {
      activeDraftId: this.activeDraftId,
      draft: this.draft ? structuredClone(this.draft) : null
    };
  }

  activate(draft, { reason = "opened" } = {}) {
    if (!draft?.id) throw new Error("Draft id is required");
    clearTimeout(this.timer);
    this.timer = null;
    this.activeDraftId = draft.id;
    this.draft = structuredClone(draft);
    this.editVersion = 0;
    this.savedVersion = 0;
    this.#emit(reason);
    return this.snapshot();
  }

  async deactivate({ flush = true, reason = "closed" } = {}) {
    if (flush) await this.flush();
    clearTimeout(this.timer);
    this.timer = null;
    this.activeDraftId = null;
    this.draft = null;
    this.editVersion = 0;
    this.savedVersion = 0;
    this.#emit(reason);
    return this.snapshot();
  }

  scheduleAutosave() {
    if (!this.activeDraftId) return;
    this.editVersion += 1;
    clearTimeout(this.timer);
    const draftId = this.activeDraftId;
    const version = this.editVersion;
    const ast = this.tree.toJSON();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (draftId !== this.activeDraftId) return;
      this.pendingSave = this.store.saveAst(draftId, ast)
        .then(draft => {
          if (draftId === this.activeDraftId && version === this.editVersion) {
            this.savedVersion = version;
            this.draft = structuredClone(draft);
          }
          return draft;
        })
        .finally(() => { this.pendingSave = null; });
    }, this.autosaveDelay);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.pendingSave) await this.pendingSave;
    if (!this.activeDraftId || this.editVersion <= this.savedVersion) return this.snapshot();
    const draftId = this.activeDraftId;
    const version = this.editVersion;
    const draft = await this.store.saveAst(draftId, this.tree.toJSON());
    if (draftId === this.activeDraftId && version === this.editVersion) {
      this.savedVersion = version;
      this.draft = structuredClone(draft);
    }
    return this.snapshot();
  }

  async saveNow() {
    if (!this.activeDraftId) return this.snapshot();
    // Explicit save must persist even if the last change happened before this session
    // started tracking edit versions.
    const draft = await this.store.saveAst(this.activeDraftId, this.tree.toJSON());
    this.draft = structuredClone(draft);
    this.savedVersion = this.editVersion;
    this.#emit("saved");
    return this.snapshot();
  }

  destroy() {
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }

  #emit(reason) {
    this.events?.emit?.("draft:session-changed", {
      reason,
      activeDraftId: this.activeDraftId,
      draft: this.draft ? structuredClone(this.draft) : null
    });
  }
}
