const SETTINGS_KEY = "editor.block-collector";
const SCHEMA_VERSION = 1;
const MAX_REFERENCES = 500;

export class BlockCollector {
  constructor({ db = null, events = null, tree = null, drafts = null, projects = null, draftSession = null, projectSession = null, registry = null } = {}) {
    Object.assign(this, { db, events, tree, drafts, projects, draftSession, projectSession, registry });
    this.references = [];
    this.initialized = false;
    this.unsubscribers = [];
    this.mutationQueue = Promise.resolve();
  }

  async initialize() {
    const stored = await this.db?.get?.("settings", SETTINGS_KEY, null);
    this.references = normalizeReferences(stored?.references || stored || []);
    this.initialized = true;
    await this.validate();
    return this.snapshot();
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      this.events?.on?.("tree:changed", () => this.#background(this.validateCurrent())),
      this.events?.on?.("draft:changed", event => this.#background(this.validateDraftEvent(event))),
      this.events?.on?.("project:changed", event => this.#background(this.validateProjectEvent(event))),
      this.events?.on?.("project:removed", event => this.#background(this.removeProject(event?.projectId)))
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  snapshot() {
    return Object.freeze({
      count: this.references.length,
      references: structuredClone(this.references)
    });
  }

  count() { return this.references.length; }

  isCollectible(node) {
    if (!node?.id || node.id === "root") return false;
    const definition = this.registry?.get?.(node.type);
    return Boolean(definition) && definition.projectVirtual !== true;
  }

  hasCurrent(nodeId) {
    const source = this.currentSource();
    if (!source) return false;
    const key = referenceKey({ ...source, nodeId });
    return this.references.some(reference => referenceKey(reference) === key);
  }

  async toggleCurrent(nodeId) {
    return this.#enqueue(async () => {
      const source = this.currentSource();
      const node = this.tree?.find?.(nodeId);
      if (!source || !this.isCollectible(node)) return this.snapshot();
      const reference = normalizeReference({
        ...source,
        nodeId: String(node.id),
        blockType: String(node.type || ""),
        addedAt: Date.now()
      });
      if (!reference) return this.snapshot();
      const key = referenceKey(reference);
      const index = this.references.findIndex(item => referenceKey(item) === key);
      const next = [...this.references];
      if (index >= 0) next.splice(index, 1);
      else {
        if (next.length >= MAX_REFERENCES) throw new Error(`Block collector limit: ${MAX_REFERENCES}`);
        next.push(reference);
      }
      await this.#commit(next, index >= 0 ? "removed" : "added");
      return this.snapshot();
    });
  }

  async clear() {
    return this.#enqueue(async () => {
      if (!this.references.length) return this.snapshot();
      await this.#commit([], "cleared");
      return this.snapshot();
    });
  }

  async validateCurrent() {
    return this.#enqueue(async () => {
      const source = this.currentSource();
      if (!source || !this.references.length) return this.snapshot();
      const next = this.references.filter(reference => (
        !sameSource(reference, source) || this.#validNode(this.tree?.find?.(reference.nodeId), reference)
      ));
      if (next.length !== this.references.length) await this.#commit(next, "pruned");
      return this.snapshot();
    });
  }

  async validateDraftEvent(event = {}) {
    return this.#enqueue(async () => {
      const draftId = String(event?.draftId || event?.draft?.id || "");
      if (!draftId) return this.snapshot();
      const ast = event.reason === "deleted" ? null : event?.draft?.messageAst;
      const next = this.references.filter(reference => {
        if (reference.kind !== "draft" || reference.draftId !== draftId) return true;
        return this.#validNode(findAstNode(ast, reference.nodeId), reference);
      });
      if (next.length !== this.references.length) await this.#commit(next, "pruned");
      return this.snapshot();
    });
  }

  async validateProjectEvent(event = {}) {
    return this.#enqueue(async () => {
      const projectId = String(event?.projectId || event?.project?.id || "");
      if (!projectId) return this.snapshot();
      const project = event?.project;
      const next = this.references.filter(reference => {
        if (reference.kind !== "project-post" || reference.projectId !== projectId) return true;
        const post = project?.posts?.find(item => String(item.id) === reference.postId);
        return this.#validNode(findAstNode(post?.messageAst, reference.nodeId), reference);
      });
      if (next.length !== this.references.length) await this.#commit(next, "pruned");
      return this.snapshot();
    });
  }

  async removeProject(projectId) {
    return this.#enqueue(async () => {
      const id = String(projectId || "");
      if (!id) return this.snapshot();
      const next = this.references.filter(reference => reference.kind !== "project-post" || reference.projectId !== id);
      if (next.length !== this.references.length) await this.#commit(next, "pruned");
      return this.snapshot();
    });
  }

  async validate() {
    return this.#enqueue(async () => {
      const documents = new Map();
      const current = this.currentSource();
      const next = [];
      for (const reference of this.references) {
        const sourceKey = sourceKeyFor(reference);
        let ast;
        if (current && sameSource(reference, current)) ast = this.tree?.toJSON?.() || this.tree?.root || null;
        else if (documents.has(sourceKey)) ast = documents.get(sourceKey);
        else {
          ast = await this.#loadSourceAst(reference);
          documents.set(sourceKey, ast);
        }
        if (this.#validNode(findAstNode(ast, reference.nodeId), reference)) next.push(reference);
      }
      if (next.length !== this.references.length) await this.#commit(next, "pruned");
      return this.snapshot();
    });
  }

  async resolveBlocks() {
    await this.validate();
    const documents = new Map();
    const current = this.currentSource();
    const blocks = [];
    for (const reference of this.references) {
      const sourceKey = sourceKeyFor(reference);
      let ast;
      if (current && sameSource(reference, current)) ast = this.tree?.toJSON?.() || this.tree?.root || null;
      else if (documents.has(sourceKey)) ast = documents.get(sourceKey);
      else {
        ast = await this.#loadSourceAst(reference);
        documents.set(sourceKey, ast);
      }
      const node = findAstNode(ast, reference.nodeId);
      if (this.#validNode(node, reference)) blocks.push(structuredClone(node));
    }
    return blocks;
  }

  currentSource() {
    if (this.projectSession?.isProjectActive?.()) {
      const snapshot = this.projectSession.snapshot?.() || {};
      const projectId = String(snapshot.activeProjectId || this.projectSession.activeProjectId || "");
      const postId = String(snapshot.activePostId || this.projectSession.activePostId || "");
      return projectId && postId ? { kind: "project-post", projectId, postId } : null;
    }
    if (this.draftSession?.isActive?.()) {
      const draftId = String(this.draftSession.activeDraftId || this.draftSession.snapshot?.()?.activeDraftId || "");
      return draftId ? { kind: "draft", draftId } : null;
    }
    return null;
  }

  #validNode(node, reference) {
    return Boolean(node && this.isCollectible(node));
  }

  async #loadSourceAst(reference) {
    if (reference.kind === "draft") return (await this.drafts?.get?.(reference.draftId))?.messageAst || null;
    if (reference.kind === "project-post") {
      return (await this.projects?.getPost?.(reference.projectId, reference.postId))?.messageAst || null;
    }
    return null;
  }

  async #commit(next, reason) {
    const references = normalizeReferences(next);
    await this.db?.put?.("settings", SETTINGS_KEY, { schemaVersion: SCHEMA_VERSION, references });
    this.references = references;
    this.events?.emit?.("block-collector:changed", { reason, ...this.snapshot() });
  }

  #enqueue(operation) {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.catch(() => {});
    return run;
  }

  #background(promise) {
    return promise.catch(error => {
      this.events?.emit?.("ui:error", { message: error?.message || String(error) });
      return this.snapshot();
    });
  }
}

function normalizeReferences(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const reference = normalizeReference(item);
    if (!reference) continue;
    const key = referenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reference);
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

function normalizeReference(input = {}) {
  const kind = input?.kind === "draft" ? "draft" : input?.kind === "project-post" ? "project-post" : "";
  const nodeId = String(input?.nodeId || "").trim();
  if (!kind || !nodeId) return null;
  if (kind === "draft") {
    const draftId = String(input?.draftId || "").trim();
    if (!draftId) return null;
    return { kind, draftId, nodeId, blockType: String(input?.blockType || ""), addedAt: Number(input?.addedAt || Date.now()) };
  }
  const projectId = String(input?.projectId || "").trim();
  const postId = String(input?.postId || "").trim();
  if (!projectId || !postId) return null;
  return { kind, projectId, postId, nodeId, blockType: String(input?.blockType || ""), addedAt: Number(input?.addedAt || Date.now()) };
}

function referenceKey(reference) {
  return `${sourceKeyFor(reference)}:${String(reference?.nodeId || "")}`;
}

function sourceKeyFor(reference) {
  return reference?.kind === "draft"
    ? `draft:${String(reference?.draftId || "")}`
    : `project-post:${String(reference?.projectId || "")}:${String(reference?.postId || "")}`;
}

function sameSource(a, b) { return sourceKeyFor(a) === sourceKeyFor(b); }

function findAstNode(node, nodeId) {
  if (!node || typeof node !== "object") return null;
  if (String(node.id || "") === String(nodeId || "")) return node;
  for (const child of node.children || []) {
    const found = findAstNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

export const BLOCK_COLLECTOR_SETTINGS_KEY = SETTINGS_KEY;
