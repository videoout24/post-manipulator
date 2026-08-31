const DEFAULT_LIMIT = 80;
const DEFAULT_CONTEXT_LIMIT = 16;
const PROPERTY_COALESCE_MS = 700;

// A bounded, in-memory undo history. It deliberately has no storage dependency:
// reloading the tab or closing it discards every snapshot.
export class EditorSessionHistory {
  constructor({
    tree,
    events = null,
    selection = null,
    projectSession = null,
    draftSession = null,
    undoButton = null,
    redoButton = null,
    documentRoot = globalThis.document ?? null,
    limit = DEFAULT_LIMIT,
    contextLimit = DEFAULT_CONTEXT_LIMIT
  } = {}) {
    Object.assign(this, {
      tree, events, selection, projectSession, draftSession,
      undoButton, redoButton, documentRoot,
      limit: Math.max(1, Number(limit) || DEFAULT_LIMIT),
      contextLimit: Math.max(1, Number(contextLimit) || DEFAULT_CONTEXT_LIMIT)
    });
    this.entries = new Map();
    this.currentKey = null;
    this.unsubscribers = [];
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("tree:changed", payload => this.#recordChange(payload)),
      this.events?.on?.("project:session-changed", () => this.#activateContext()),
      this.events?.on?.("draft:session-changed", () => this.#activateContext())
    );
    this.#listen(this.undoButton, "click", () => this.undo());
    this.#listen(this.redoButton, "click", () => this.redo());
    this.#listen(this.documentRoot, "keydown", event => this.#handleKeydown(event));
    this.#activateContext();
    return this;
  }

  stop() { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.(); }

  canUndo() { return Boolean(this.#currentEntry()?.undo.length); }
  canRedo() { return Boolean(this.#currentEntry()?.redo.length); }

  undo() { return this.#restore("undo", "redo"); }
  redo() { return this.#restore("redo", "undo"); }

  #restore(from, to) {
    const entry = this.#currentEntry();
    if (!entry?.[from]?.length) return false;
    const snapshot = entry[from].pop();
    entry[to].push(clone(entry.current));
    entry.current = clone(snapshot);
    entry.lastKind = "";
    entry.lastChangedAt = 0;
    this.tree.root = clone(snapshot);
    this.selection?.clear?.();
    this.events?.emit?.("tree:changed", { source: "history" });
    this.#notify();
    return true;
  }

  #recordChange(payload = {}) {
    if (payload?.source === "history") return;
    const entry = this.#currentEntry();
    if (!entry) return;
    const after = this.#snapshot();
    if (sameSnapshot(entry.current, after)) return;

    const kind = payload?.source === "property" ? "property" : "mutation";
    const now = Date.now();
    const coalesce = kind === "property"
      && entry.lastKind === "property"
      && now - entry.lastChangedAt < PROPERTY_COALESCE_MS;
    if (!coalesce) {
      entry.undo.push(clone(entry.current));
      if (entry.undo.length > this.limit) entry.undo.splice(0, entry.undo.length - this.limit);
    }
    entry.redo = [];
    entry.current = after;
    entry.lastKind = kind;
    entry.lastChangedAt = now;
    this.#touch(entry.key);
    this.#notify();
  }

  #activateContext() {
    const key = this.#contextKey();
    const snapshot = this.#snapshot();
    this.currentKey = key;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = createEntry(key, snapshot);
      this.entries.set(key, entry);
      this.#pruneContexts();
    } else if (!sameSnapshot(entry.current, snapshot)) {
      // A context may have changed outside ordinary Canvas editing (for example,
      // after graph reconciliation). Its prior snapshots are no longer safe.
      entry.undo = [];
      entry.redo = [];
      entry.current = snapshot;
      entry.lastKind = "";
      entry.lastChangedAt = 0;
    }
    this.#touch(key);
    this.#pruneContexts();
    this.#notify();
    return entry;
  }

  #currentEntry() {
    const key = this.#contextKey();
    if (key !== this.currentKey) return this.#activateContext();
    const entry = this.entries.get(key);
    if (entry) return entry;
    return this.#activateContext();
  }

  #contextKey() {
    if (this.projectSession?.isProjectActive?.() && this.projectSession.activeProjectId && this.projectSession.activePostId) {
      return `project:${this.projectSession.activeProjectId}:${this.projectSession.activePostId}`;
    }
    if (this.draftSession?.isActive?.() && this.draftSession.activeDraftId) return `draft:${this.draftSession.activeDraftId}`;
    return "standalone";
  }

  #snapshot() { return clone(this.tree?.toJSON?.() || this.tree?.root || emptyDocument()); }

  #touch(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  #pruneContexts() {
    while (this.entries.size > this.contextLimit) {
      const oldest = this.entries.keys().next().value;
      if (!oldest || oldest === this.currentKey) break;
      this.entries.delete(oldest);
    }
  }

  #notify() {
    const entry = this.entries.get(this.currentKey);
    const state = {
      contextKey: this.currentKey,
      canUndo: Boolean(entry?.undo.length),
      canRedo: Boolean(entry?.redo.length)
    };
    this.#updateButtons(state);
    this.events?.emit?.("editor:history-changed", state);
  }

  #updateButtons({ canUndo, canRedo }) {
    if (this.undoButton) {
      this.undoButton.disabled = !canUndo;
      this.undoButton.setAttribute?.("aria-disabled", String(!canUndo));
      this.undoButton.title = canUndo ? "Отменить изменение (Ctrl/Cmd + Z)" : "Нет изменений для отмены";
    }
    if (this.redoButton) {
      this.redoButton.disabled = !canRedo;
      this.redoButton.setAttribute?.("aria-disabled", String(!canRedo));
      this.redoButton.title = canRedo ? "Повторить изменение (Ctrl/Cmd + Shift + Z)" : "Нет изменений для повтора";
    }
  }

  #handleKeydown(event) {
    if (event?.defaultPrevented || event?.isComposing || event?.altKey || !(event?.ctrlKey || event?.metaKey)) return;
    const key = String(event.key || "").toLowerCase();
    const redo = key === "y" || (key === "z" && event.shiftKey);
    const undo = key === "z" && !event.shiftKey;
    if (!undo && !redo) return;
    if (event.target?.closest?.("dialog[open]")) return;
    const changed = redo ? this.redo() : this.undo();
    if (changed) event.preventDefault();
  }

  #listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    this.unsubscribers.push(() => target.removeEventListener?.(name, handler));
  }
}

function createEntry(key, snapshot) {
  return { key, undo: [], redo: [], current: clone(snapshot), lastKind: "", lastChangedAt: 0 };
}

function emptyDocument() { return { id: "root", type: "document", props: {}, children: [] }; }
function clone(value) { return structuredClone(value); }
function sameSnapshot(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
