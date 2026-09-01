import {
  createEmptyDocumentAst,
  getProjectRootMap,
  isLinearProject,
  isProjectRootMapNode,
  protectedProjectNodeError
} from "./ProjectStore.js?v=1.7.6";

const SESSION_KEY = "project.editor.session";

export class ProjectEditorSession {
  constructor({ store, tree, storage, db, events = null, autosaveDelay = 250, beforeOpenProject = null } = {}) {
    this.store = store;
    this.tree = tree;
    this.storage = storage;
    this.db = db;
    this.events = events;
    this.autosaveDelay = autosaveDelay;
    this.activeProjectId = null;
    this.activePostId = null;
    this.project = null;
    this.timer = null;
    this.pendingSave = null;
    this.switchGeneration = 0;
    this.editVersion = 0;
    this.savedVersion = 0;
    this.beforeOpenProject = beforeOpenProject;
    this.unsubscribeStore = this.events?.on?.("project:changed", event => {
      if (event?.projectId !== this.activeProjectId || !event?.project || event.reason === "deleted") return;
      this.project = structuredClone(event.project);

      // Graph reconciliation may mutate the AST of the post that is currently open
      // (derived Map text, invalid relation cleanup, managed backlink changes). The
      // canonical Project must then flow back into the live Editor tree; otherwise a
      // later edit can write the stale pre-reconcile AST over the repaired graph.
      const affected = new Set((event?.affectedPostIds || []).map(String));
      const activeWasReconciled = event.reason === "graph-reconciled"
        && this.activePostId
        && affected.has(String(this.activePostId));
      if (activeWasReconciled && !this.#hasUnsavedEdits()) {
        const active = this.project.posts?.find(post => post.id === this.activePostId);
        if (active && stableAst(this.tree.toJSON()) !== stableAst(active.messageAst)) {
          this.#replaceTree(active.messageAst);
          this.#emit("graph-reconciled");
        }
      }
    });
  }

  isProjectActive() { return Boolean(this.activeProjectId); }
  isLinearProject() { return isLinearProject(this.project); }
  isRootMapNode(nodeId) { return isProjectRootMapNode(this.project, nodeId); }

  structureMutationError(request = {}) {
    return protectedProjectNodeError(this.project, this.activePostId, request);
  }

  setBeforeOpenProject(handler) {
    this.beforeOpenProject = typeof handler === "function" ? handler : null;
  }

  snapshot() {
    return {
      activeProjectId: this.activeProjectId,
      activePostId: this.activePostId,
      project: this.project ? structuredClone(this.project) : null
    };
  }

  currentProjectSnapshot() {
    if (!this.project) return null;
    const project = structuredClone(this.project);
    const active = project.posts?.find(post => post.id === this.activePostId);
    if (active) active.messageAst = this.tree.toJSON();
    return project;
  }

  async initialize() {
    const saved = await this.db?.get?.("runtime", SESSION_KEY, null);
    if (!saved?.projectId) {
      this.#emit("initialized");
      return this.snapshot();
    }
    const project = await this.store.getProject(saved.projectId);
    if (!project) {
      await this.db?.delete?.("runtime", SESSION_KEY);
      this.#emit("initialized");
      return this.snapshot();
    }
    await this.openProject(project.id, { postId: saved.postId, preserveScratch: true, reason: "restored" });
    return this.snapshot();
  }

  async openProject(projectId, { postId = null, preserveScratch = false, reason = "project-opened" } = {}) {
    if (!projectId) throw new Error("Project id is required");
    if (this.activeProjectId === projectId && this.project) {
      const target = postId || this.activePostId || this.project.posts?.[0]?.id || null;
      if (target && target !== this.activePostId) await this.openPost(target);
      return this.snapshot();
    }

    await this.flush();
    // A document is either a Project post or a Draft. Do not keep a third,
    // nameless Canvas snapshot when switching to a Project.
    if (!this.activeProjectId && !preserveScratch) this.storage?.clear?.();
    await this.beforeOpenProject?.({
      projectId: String(projectId),
      previousProjectId: this.activeProjectId ? String(this.activeProjectId) : null,
      reason
    });

    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    this.project = project;
    this.activeProjectId = project.id;
    const targetPost = project.posts.find(post => post.id === postId) || project.posts[0] || null;
    this.activePostId = targetPost?.id || null;
    this.#replaceTree(targetPost?.messageAst || createEmptyDocumentAst());
    await this.#persistSession();
    this.#emit(reason);
    return this.snapshot();
  }

  async closeProject({ reason = "project-closed" } = {}) {
    if (!this.activeProjectId) return this.snapshot();
    await this.flush();
    this.switchGeneration += 1;
    this.activeProjectId = null;
    this.activePostId = null;
    this.project = null;
    this.#replaceTree(createEmptyDocumentAst());
    this.storage?.clear?.();
    await this.db?.delete?.("runtime", SESSION_KEY);
    this.#emit(reason);
    return this.snapshot();
  }

  async openStandaloneAst(ast, { reason = "standalone-opened", persist = true } = {}) {
    await this.flush();
    this.switchGeneration += 1;
    this.activeProjectId = null;
    this.activePostId = null;
    this.project = null;
    this.#replaceTree(ast || createEmptyDocumentAst());
    if (persist) this.storage?.save?.(this.tree.toJSON());
    else this.storage?.clear?.();
    await this.db?.delete?.("runtime", SESSION_KEY);
    this.#emit(reason);
    return this.snapshot();
  }

  async openPost(postId) {
    if (!this.activeProjectId) throw new Error("Project is not active");
    if (postId === this.activePostId) return this.snapshot();
    await this.flush();
    const project = await this.store.getProject(this.activeProjectId);
    if (!project) throw new Error(`Project not found: ${this.activeProjectId}`);
    const post = project.posts.find(item => item.id === postId);
    if (!post) throw new Error(`Project post not found: ${postId}`);
    this.project = project;
    this.activePostId = post.id;
    this.#replaceTree(post.messageAst);
    await this.#persistSession();
    this.#emit("post-opened");
    return this.snapshot();
  }

  scheduleAutosave() {
    if (!this.activeProjectId || !this.activePostId) return;
    this.editVersion += 1;
    clearTimeout(this.timer);
    const projectId = this.activeProjectId;
    const postId = this.activePostId;
    const generation = this.switchGeneration;
    const version = this.editVersion;
    const ast = this.tree.toJSON();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.switchGeneration) return;
      this.pendingSave = this.#saveSnapshot(projectId, postId, ast)
        .then(result => {
          if (generation === this.switchGeneration && projectId === this.activeProjectId && postId === this.activePostId && this.editVersion === version) {
            this.savedVersion = version;
          }
          return result;
        })
        .finally(() => { this.pendingSave = null; });
    }, this.autosaveDelay);
  }

  async saveNow() {
    if (!this.activeProjectId) {
      return this.snapshot();
    }
    await this.flush({ captureCurrent: true });
    this.#emit("saved");
    return this.snapshot();
  }

  async flush({ captureCurrent = true } = {}) {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.pendingSave) await this.pendingSave;
    if (!captureCurrent || !this.activeProjectId || !this.activePostId) return;
    if (this.editVersion <= this.savedVersion) return;
    const projectId = this.activeProjectId;
    const postId = this.activePostId;
    const version = this.editVersion;
    const generation = this.switchGeneration;
    const ast = this.tree.toJSON();
    await this.#saveSnapshot(projectId, postId, ast);
    if (generation === this.switchGeneration && projectId === this.activeProjectId && postId === this.activePostId && this.editVersion === version) {
      this.savedVersion = version;
    }
  }

  async createPost(title = "") {
    if (!this.activeProjectId) throw new Error("Project is not active");
    await this.flush();
    const { project, post } = await this.store.createPost(this.activeProjectId, { title });
    this.project = project;
    this.activePostId = post.id;
    this.#replaceTree(post.messageAst);
    await this.#persistSession();
    this.#emit("post-created");
    return structuredClone(post);
  }

  async createPostFromMapSlot(title = "") {
    if (!this.activeProjectId || !isLinearProject(this.project)) {
      throw new Error("Посты структурированного проекта создаются только из карты проекта");
    }
    const rootMap = getProjectRootMap(this.project);
    if (!rootMap || String(this.activePostId) !== String(this.project.structure?.rootPostId)) {
      throw new Error("Новый пост можно добавить только из карты стартового поста");
    }
    await this.flush();
    const nextNumber = (this.project.posts?.length || 0) + 1;
    const { project, post } = await this.store.createPost(this.activeProjectId, {
      title: String(title || "").trim() || `Пост ${nextNumber}`
    });
    this.project = project;
    // Adding a slot is an action in the Map, so keep the user in the start post
    // and immediately show its canonical updated slots.
    const root = project.posts.find(item => String(item.id) === String(this.activePostId));
    if (root) this.#replaceTree(root.messageAst);
    this.#emit("post-created-from-map");
    return structuredClone(post);
  }

  async movePostInMap(postId, direction) {
    if (!this.activeProjectId || !isLinearProject(this.project)) throw new Error("Карта проекта недоступна");
    await this.flush();
    this.project = await this.store.movePost(this.activeProjectId, postId, direction);
    const active = this.project.posts?.find(post => String(post.id) === String(this.activePostId));
    if (active && stableAst(this.tree.toJSON()) !== stableAst(active.messageAst)) {
      this.#replaceTree(active.messageAst);
    }
    this.#emit("post-reordered");
    return this.snapshot();
  }

  async renamePost(postId, title) {
    if (!this.activeProjectId) throw new Error("Project is not active");
    await this.flush();
    this.project = await this.store.renamePost(this.activeProjectId, postId, title);
    const active = this.project.posts.find(post => post.id === this.activePostId);
    if (active) this.#replaceTree(active.messageAst);
    this.#emit("post-renamed");
    return this.snapshot();
  }

  async deletePost(postId) {
    if (!this.activeProjectId) throw new Error("Project is not active");
    await this.flush();
    const current = await this.store.getProject(this.activeProjectId);
    if (!current) throw new Error(`Project not found: ${this.activeProjectId}`);
    if (isLinearProject(current)) {
      if (String(postId) === String(current.structure?.rootPostId)) {
        await this.store.deletePost(this.activeProjectId, postId);
        return this.closeProject({ reason: "project-deleted" });
      }
    }
    if (current.posts.length <= 1) throw new Error("В проекте должен остаться хотя бы один пост");
    const index = current.posts.findIndex(post => post.id === postId);
    if (index < 0) throw new Error(`Project post not found: ${postId}`);
    const nextCandidate = current.posts[index + 1] || current.posts[index - 1];
    this.project = await this.store.deletePost(this.activeProjectId, postId);
    if (this.activePostId === postId) {
      const next = this.project.posts.find(post => post.id === nextCandidate?.id) || this.project.posts[0];
      this.activePostId = next?.id || null;
      this.#replaceTree(next?.messageAst || createEmptyDocumentAst());
      await this.#persistSession();
    } else {
      const active = this.project.posts.find(post => String(post.id) === String(this.activePostId));
      if (active && stableAst(this.tree.toJSON()) !== stableAst(active.messageAst)) {
        this.#replaceTree(active.messageAst);
      }
    }
    this.#emit("post-deleted");
    return this.snapshot();
  }

  async rebindBacklinkRelation(backlinkNodeId, { targetMapId, targetSlotId } = {}) {
    if (isLinearProject(this.project)) {
      throw new Error("«Назад к карте» всегда ведёт к единственной карте проекта и не перепривязывается");
    }
    if (!this.activeProjectId || !this.activePostId) throw new Error("Back to Map требует активный Project post");
    const nextMapId = cleanId(targetMapId);
    const nextSlotId = cleanId(targetSlotId);
    if (!nextMapId || !nextSlotId) throw new Error("Выберите целевую Map и Slot");

    await this.flush();
    const projectId = this.activeProjectId;
    const activePostId = this.activePostId;
    const affectedPostIds = new Set([activePostId]);

    const project = await this.store.updateProject(projectId, draft => {
      const activePost = draft.posts?.find(post => String(post.id) === String(activePostId));
      if (!activePost) throw new Error(`Project post not found: ${activePostId}`);
      const backlink = findAstNode(activePost.messageAst, backlinkNodeId);
      if (!backlink || backlink.type !== "project_map_backlink") throw new Error("Back to Map block not found");

      const oldMapId = cleanId(backlink.props?.targetMapId);
      const oldSlotId = cleanId(backlink.props?.targetSlotId);
      const maps = collectProjectMaps(draft);
      const nextMap = maps.find(item => item.mapId === nextMapId);
      if (!nextMap) throw new Error("Целевая Map не найдена");
      if (String(nextMap.hostPostId) === String(activePostId)) throw new Error("Map не может ссылаться на собственный пост-контейнер");

      const duplicateBacklink = findBacklinkToMap(activePost.messageAst, nextMapId, backlinkNodeId);
      if (duplicateBacklink) throw new Error("В этом посте уже есть Back to Map на выбранную Map");

      const nextSlot = nextMap.slots.find(slot => cleanId(slot?.id) === nextSlotId);
      if (!nextSlot) throw new Error("Целевой Slot не найден");
      const occupiedBy = cleanId(nextSlot.targetPostId);
      if (occupiedBy && occupiedBy !== String(activePostId)) throw new Error("Выбранный Slot уже занят другим постом");

      const oldMap = oldMapId ? maps.find(item => item.mapId === oldMapId) : null;
      const oldSlot = oldMap
        ? (oldMap.slots.find(slot => cleanId(slot?.id) === oldSlotId && cleanId(slot?.targetPostId) === String(activePostId))
          || oldMap.slots.find(slot => cleanId(slot?.targetPostId) === String(activePostId)))
        : null;

      // A post may occupy only one slot inside a single Map. Release the previous slot
      // first so moving inside the same Map is an atomic relation replacement.
      for (const slot of nextMap.slots) {
        if (cleanId(slot?.targetPostId) !== String(activePostId)) continue;
        if (cleanId(slot?.id) === nextSlotId) continue;
        slot.targetPostId = null;
        slot.text = "";
        delete slot.derivedFromPostId;
      }
      if (oldSlot && (oldMapId !== nextMapId || cleanId(oldSlot.id) !== nextSlotId)) {
        oldSlot.targetPostId = null;
        oldSlot.text = "";
        delete oldSlot.derivedFromPostId;
      }

      nextSlot.targetPostId = String(activePostId);
      nextSlot.derivedFromPostId = String(activePostId);
      // Reconciler owns the canonical derived text; setting it now keeps the operation
      // visually coherent before the reconciliation event completes.
      nextSlot.text = firstHeadingTextFromAst(activePost.messageAst);

      backlink.props ||= {};
      backlink.props.targetMapId = nextMapId;
      backlink.props.targetSlotId = nextSlotId;
      backlink.props.managedByMap = true;

      affectedPostIds.add(String(nextMap.hostPostId));
      if (oldMap?.hostPostId) affectedPostIds.add(String(oldMap.hostPostId));
      activePost.updatedAt = Date.now();
      return true;
    }, "backlink-rebound", () => ({ postId: activePostId, affectedPostIds: [...affectedPostIds] }));

    this.project = project;
    const active = project.posts?.find(post => String(post.id) === String(activePostId));
    if (active) this.#replaceTree(active.messageAst);
    this.#emit("backlink-rebound");
    return this.snapshot();
  }

  async refreshProject({ reloadActiveAst = false } = {}) {
    if (!this.activeProjectId) return this.snapshot();
    const project = await this.store.getProject(this.activeProjectId);
    if (!project) return this.closeProject({ reason: "project-missing" });
    this.project = project;
    if (!project.posts.some(post => post.id === this.activePostId)) {
      this.activePostId = project.posts[0]?.id || null;
      reloadActiveAst = true;
    }
    if (reloadActiveAst) {
      const active = project.posts.find(post => post.id === this.activePostId);
      this.#replaceTree(active?.messageAst || createEmptyDocumentAst());
    }
    this.#emit("project-refreshed");
    return this.snapshot();
  }

  async #saveSnapshot(projectId, postId, ast) {
    const project = await this.store.savePostAst(projectId, postId, ast);
    if (this.activeProjectId === projectId) {
      this.project = project;
      const active = project.posts?.find(post => String(post.id) === String(this.activePostId));
      // The Store owns Project invariants. If it repaired a structural block while
      // saving, put that canonical AST back into Canvas immediately.
      if (active && stableAst(this.tree.toJSON()) !== stableAst(active.messageAst)) this.#replaceTree(active.messageAst);
    }
    return project;
  }

  #replaceTree(ast) {
    this.switchGeneration += 1;
    this.editVersion = 0;
    this.savedVersion = 0;
    this.tree.root = structuredClone(ast || createEmptyDocumentAst());
    this.tree.root.id = "root";
  }

  #hasUnsavedEdits() {
    return Boolean(this.timer || this.pendingSave || this.editVersion > this.savedVersion);
  }

  async #persistSession() {
    if (!this.activeProjectId) return;
    await this.db?.put?.("runtime", SESSION_KEY, { projectId: this.activeProjectId, postId: this.activePostId });
  }

  #emit(reason) {
    this.events?.emit("project:session-changed", { reason, ...this.snapshot() });
  }
}

function cleanId(value) {
  return value == null ? "" : String(value).trim();
}

function findAstNode(node, nodeId) {
  if (!node || typeof node !== "object") return null;
  if (String(node.id || "") === String(nodeId || "")) return node;
  for (const child of node.children || []) {
    const found = findAstNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function collectProjectMaps(project) {
  const maps = [];
  for (const post of project?.posts || []) {
    walkAst(post.messageAst, node => {
      if (node?.type !== "project_post_map") return;
      const mapId = cleanId(node.props?.mapId);
      if (!mapId) return;
      maps.push({
        mapId,
        hostPostId: post.id,
        node,
        slots: Array.isArray(node.props?.slots) ? node.props.slots : []
      });
    });
  }
  return maps;
}

function findBacklinkToMap(ast, mapId, excludeNodeId = null) {
  let found = null;
  walkAst(ast, node => {
    if (found || node?.type !== "project_map_backlink") return;
    if (excludeNodeId && String(node.id || "") === String(excludeNodeId)) return;
    if (cleanId(node.props?.targetMapId) === cleanId(mapId)) found = node;
  });
  return found;
}

function firstHeadingTextFromAst(ast) {
  let value = "";
  walkAst(ast, node => {
    if (value || node?.type !== "heading") return;
    value = richTextPlain(node.props?.text);
  });
  return value;
}

function richTextPlain(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(richTextPlain).join("");
  if (typeof value === "object") {
    if (value.text != null) return richTextPlain(value.text);
    if (value.children != null) return richTextPlain(value.children);
  }
  return "";
}

function walkAst(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walkAst(child, fn);
}

function stableAst(ast) {
  try { return JSON.stringify(ast || null); }
  catch { return String(ast); }
}
