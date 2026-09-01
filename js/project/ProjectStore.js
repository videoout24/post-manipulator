import { randomUUID } from "../core/Random.js?v=1.5.9";
import { createProjectHeading, syncHeadingFromPostTitle, syncPostTitleFromHeading } from "./ProjectPostHeading.js?v=1.5.9";
import { projectGraphInputFingerprint } from "./ProjectGraphInputs.js?v=1.5.9";

const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_STRUCTURE_MODE = "linear";

export class ProjectStore {
  constructor({ db, events = null } = {}) {
    if (!db) throw new Error("ProjectStore requires AppDatabase");
    this.db = db;
    this.events = events;
    this.writeQueues = new Map();
  }

  async listProjects() {
    const rows = await this.db.all("projects");
    return rows
      .map(row => normalizeProject(row.value, row.key))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  async getProject(projectId) {
    if (!projectId) return null;
    const value = await this.db.get("projects", projectId, null);
    return value ? normalizeProject(value, projectId) : null;
  }

  async createProject({ title = "Новый проект", firstPostTitle = "Пост 1" } = {}) {
    const now = Date.now();
    const rootPost = createPostRecord({ title: firstPostTitle, now });
    const rootMapId = `map_${randomUUID()}`;
    rootPost.messageAst = createRootProjectAst(rootPost.title, rootMapId);
    const project = {
      id: makeId("project"),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      title: cleanTitle(title, "Новый проект"),
      structure: {
        mode: PROJECT_STRUCTURE_MODE,
        rootPostId: rootPost.id,
        rootMapId
      },
      posts: [rootPost],
      createdAt: now,
      updatedAt: now
    };
    await this.db.put("projects", project.id, project);
    this.#emit("created", project);
    return structuredClone(project);
  }

  async saveProject(project) {
    if (!project?.id) throw new Error("Project id is required");
    return this.#queue(project.id, async () => {
      const normalized = normalizeProject(project, project.id);
      normalized.updatedAt = Date.now();
      await this.db.put("projects", normalized.id, normalized);
      this.#emit("saved", normalized);
      return structuredClone(normalized);
    });
  }

  async deleteProject(projectId) {
    if (!projectId) return false;
    return this.#queue(projectId, async () => {
      const current = await this.getProject(projectId);
      if (!current) return false;
      const publishedPost = (current.posts || []).find(isPublishedProductionPost);
      if (publishedPost) {
        throw new Error("Нельзя удалить Project, пока в нём есть опубликованные посты. Сначала удалите их из Публикаций.");
      }
      await this.db.delete("projects", projectId);
      this.#emit("deleted", current);
      this.events?.emit("project:removed", { projectId, project: structuredClone(current) });
      return true;
    });
  }

  async renameProject(projectId, title) {
    return this.updateProject(projectId, project => {
      project.title = cleanTitle(title, project.title || "Проект");
    }, "renamed");
  }

  async createPost(projectId, { title, messageAst = null } = {}) {
    let created = null;
    const project = await this.updateProject(projectId, draft => {
      const nextNumber = (draft.posts?.length || 0) + 1;
      created = createPostRecord({ title: cleanTitle(title, `Пост ${nextNumber}`), messageAst, now: Date.now() });
      if (isLinearProject(draft)) {
        const root = getProjectRootPost(draft);
        const map = getProjectRootMap(draft);
        if (!root || !map) throw new Error("Карта проекта не найдена");
        const slotId = `slot_${randomUUID()}`;
        map.props.slots.push({
          id: slotId,
          targetPostId: created.id,
          text: created.title,
          derivedFromPostId: created.id
        });
        created.messageAst = createChildProjectAst(created.title, map.props.mapId, slotId, messageAst);
      }
      draft.posts.push(created);
    }, "post-created", () => ({ postId: created?.id || null, affectedPostIds: created?.id ? [created.id] : [] }));
    return { project, post: structuredClone(created) };
  }

  async getPost(projectId, postId) {
    const project = await this.getProject(projectId);
    const post = project?.posts?.find(item => item.id === postId) || null;
    return post ? structuredClone(post) : null;
  }

  async savePostAst(projectId, postId, messageAst) {
    let graphRelevantChanged = false;
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      const nextAst = normalizeAst(messageAst);
      const sourceChanged = astSignature(post.messageAst) !== astSignature(nextAst);
      graphRelevantChanged = projectGraphInputFingerprint(post.messageAst) !== projectGraphInputFingerprint(nextAst);
      post.messageAst = nextAst;
      syncPostTitleFromHeading(post);
      if (sourceChanged) markPostProductionChanges(post);
      post.updatedAt = Date.now();
    }, "post-saved", () => ({ postId, affectedPostIds: [postId], graphRelevantChanged }));
  }

  async setPostDeployment(projectId, postId, deployment, record) {
    if (!deployment) throw new Error("Deployment name is required");
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      post.deployments ||= {};
      if (record == null) delete post.deployments[deployment];
      else post.deployments[deployment] = structuredClone(record);
      post.updatedAt = Date.now();
    }, "deployment-saved");
  }

  // Production is a real publication state, unlike Preview which is a disposable
  // staging projection. Keep the Telegram identity and the logical state in one
  // queued Project update so UI projections never observe a published post without
  // an address (or vice versa).
  async savePostProduction(projectId, postId, { deployment, publishedAt = Date.now(), productionContentSnapshot = null } = {}) {
    if (!deployment?.chatId || !deployment?.messageId) {
      throw new Error("Production deployment requires chatId and messageId");
    }
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      post.deployments ||= {};
      post.deployments.production = structuredClone(deployment);
      post.publication = {
        ...(post.publication || {}),
        state: "published",
        publishedAt: Number(publishedAt) || Date.now(),
        hasUnappliedChanges: false
      };
      if (productionContentSnapshot != null) {
        post.publication.productionContentSnapshot = String(productionContentSnapshot);
      }
      delete post.publication.scheduledAt;
      post.schedule = null;
      post.updatedAt = Date.now();
    }, "production-saved", { postId, affectedPostIds: [postId] });
  }

  async savePostSchedule(projectId, postId, schedule) {
    if (!schedule?.scheduledAt || !schedule?.chatId) {
      throw new Error("Schedule requires publication time and target chat");
    }
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      if (post.deployments?.production?.messageId) throw new Error("Опубликованный пост нельзя отложить");
      post.schedule = structuredClone(schedule);
      post.publication = {
        ...(post.publication || {}),
        state: "scheduled",
        scheduledAt: Number(schedule.scheduledAt)
      };
      delete post.publication.publishedAt;
      post.updatedAt = Date.now();
    }, "schedule-saved", { postId, affectedPostIds: [postId] });
  }

  async clearPostSchedule(projectId, postId) {
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      if (!post.schedule && post.publication?.state !== "scheduled") return false;
      post.schedule = null;
      post.publication = { ...(post.publication || {}), state: "draft" };
      delete post.publication.scheduledAt;
      delete post.publication.publishedAt;
      post.updatedAt = Date.now();
    }, "schedule-cleared", { postId, affectedPostIds: [postId] });
  }

  async clearPostProduction(projectId, postId) {
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      if (!post.deployments?.production) return false;
      delete post.deployments.production;
      post.publication = { ...(post.publication || {}), state: "draft" };
      delete post.publication.publishedAt;
      post.updatedAt = Date.now();
    }, "production-cleared", { postId, affectedPostIds: [postId] });
  }


  async clearProjectDeployment(projectId, deployment) {
    if (!deployment) throw new Error("Deployment name is required");
    return this.updateProject(projectId, project => {
      let changed = false;
      for (const post of project.posts || []) {
        if (!post.deployments?.[deployment]) continue;
        delete post.deployments[deployment];
        post.updatedAt = Date.now();
        changed = true;
      }
      return changed ? true : false;
    }, "deployment-cleared");
  }

  async renamePost(projectId, postId, title) {
    return this.updateProject(projectId, project => {
      const post = project.posts.find(item => item.id === postId);
      if (!post) throw new Error(`Project post not found: ${postId}`);
      post.title = cleanTitle(title, post.title || "Пост");
      syncHeadingFromPostTitle(post);
      markPostProductionChanges(post);
      post.updatedAt = Date.now();
    }, "post-renamed", { postId, affectedPostIds: [postId] });
  }

  async deletePost(projectId, postId) {
    const current = await this.getProject(projectId);
    if (!current) throw new Error(`Project not found: ${projectId}`);
    const targetPost = current.posts.find(item => String(item.id) === String(postId));
    if (isPublishedProductionPost(targetPost)) {
      throw new Error("Нельзя удалить опубликованный Project post. Сначала удалите публикацию.");
    }
    if (isLinearProject(current)) {
      if (String(getProjectRootPost(current)?.id) === String(postId)) {
        await this.deleteProject(projectId);
        return null;
      }
    }
    let deletedPost = null;
    const affectedPostIds = new Set([String(postId)]);
    const project = await this.updateProject(projectId, draft => {
      const index = draft.posts.findIndex(item => item.id === postId);
      if (index < 0) throw new Error(`Project post not found: ${postId}`);
      if (draft.posts.length <= 1) throw new Error("В проекте должен остаться хотя бы один пост");
      deletedPost = structuredClone(draft.posts[index]);
      for (const hostPost of draft.posts) {
        let containsTarget = false;
        walkAst(hostPost.messageAst, node => {
          if (node?.type !== "project_post_map") return;
          if ((node.props?.slots || []).some(slot => String(slot?.targetPostId) === String(postId))) containsTarget = true;
        });
        if (!containsTarget) continue;
        affectedPostIds.add(String(hostPost.id));
        markPostProductionChanges(hostPost);
        hostPost.updatedAt = Date.now();
      }
      draft.posts.splice(index, 1);
    }, "post-deleted", () => ({ postId, affectedPostIds: [...affectedPostIds] }));
    this.events?.emit("project:post-removed", {
      projectId,
      project: structuredClone(project),
      post: deletedPost
    });
    return project;
  }

  async movePost(projectId, postId, direction) {
    if (!["up", "down"].includes(direction)) throw new Error(`Unknown post move direction: ${direction}`);
    let affectedPostIds = [];
    return this.updateProject(projectId, draft => {
      if (!isLinearProject(draft)) throw new Error("Порядок можно менять только в структурированном проекте");
      const root = getProjectRootPost(draft);
      const map = getProjectRootMap(draft);
      if (!root || !map || String(postId) === String(root.id)) throw new Error("Стартовый пост проекта закреплён");
      const slots = map.props.slots;
      const index = slots.findIndex(slot => String(slot?.targetPostId) === String(postId));
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= slots.length) return false;
      [slots[index], slots[nextIndex]] = [slots[nextIndex], slots[index]];
      markPostProductionChanges(root);
      root.updatedAt = Date.now();
      affectedPostIds = [String(root.id)];
      return true;
    }, "post-reordered", () => ({ postId, affectedPostIds }));
  }

  async updateProject(projectId, mutate, reason = "saved", details = null) {
    if (!projectId) throw new Error("Project id is required");
    return this.#queue(projectId, async () => {
      const current = await this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const draft = structuredClone(current);
      const mutationResult = await mutate?.(draft);
      if (mutationResult === false) return structuredClone(current);
      draft.updatedAt = Date.now();
      const normalized = normalizeProject(draft, projectId);
      await this.db.put("projects", projectId, normalized);
      const eventDetails = typeof details === "function" ? details(normalized) : details;
      this.#emit(reason, normalized, eventDetails);
      return structuredClone(normalized);
    });
  }

  #queue(projectId, operation) {
    const previous = this.writeQueues.get(projectId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.writeQueues.set(projectId, current);
    current.then(
      () => { if (this.writeQueues.get(projectId) === current) this.writeQueues.delete(projectId); },
      () => { if (this.writeQueues.get(projectId) === current) this.writeQueues.delete(projectId); }
    );
    return current;
  }

  #emit(reason, project, details = null) {
    this.events?.emit("project:changed", {
      reason,
      projectId: project?.id || null,
      project: project ? structuredClone(project) : null,
      ...(details && typeof details === "object" ? structuredClone(details) : {})
    });
  }
}

export function createEmptyDocumentAst() {
  return { id: "root", type: "document", props: {}, children: [] };
}

function createPostRecord({ title, messageAst = null, now = Date.now() } = {}) {
  const post = {
    id: makeId("post"),
    title: cleanTitle(title, "Пост"),
    messageAst: messageAst ? normalizeAst(messageAst) : {
      id: "root",
      type: "document",
      props: {},
      children: [createProjectHeading(cleanTitle(title, "Пост"))]
    },
    schedule: null,
    publication: { state: "draft" },
    deployments: {},
    createdAt: now,
    updatedAt: now
  };
  // Do not force a supplied document's Heading to the first position. If it
  // already has one, a caller-provided title still renames it; otherwise the
  // project normalizer appends the required Heading without reordering content.
  if (!messageAst || findFirstNode(post.messageAst, node => node?.type === "heading")) {
    syncHeadingFromPostTitle(post);
  }
  return post;
}

export function isLinearProject(project) {
  return project?.structure?.mode === PROJECT_STRUCTURE_MODE;
}

export function getProjectRootPost(project) {
  const rootId = String(project?.structure?.rootPostId || "");
  return project?.posts?.find(post => String(post.id) === rootId) || project?.posts?.[0] || null;
}

export function getProjectRootMap(project) {
  const root = getProjectRootPost(project);
  if (!root) return null;
  const mapId = String(project?.structure?.rootMapId || "");
  return findFirstNode(root.messageAst, node => node?.type === "project_post_map"
    && (!mapId || String(node?.props?.mapId) === mapId)) || null;
}

export function isProjectRootMapNode(project, nodeId) {
  return String(getProjectRootMap(project)?.id || "") === String(nodeId || "");
}

export function protectedProjectNodeError(project, activePostId, { action, nodeId, type, key } = {}) {
  if (!isLinearProject(project)) return "";
  const root = getProjectRootPost(project);
  const active = project?.posts?.find(post => String(post.id) === String(activePostId)) || null;
  if (!root || !active) return "";
  const rootMap = getProjectRootMap(project);
  const postHeading = findFirstNode(active.messageAst, node => node?.type === "heading");
  const isRoot = String(active.id) === String(root.id);
  const protectedId = String(nodeId || "");

  if (action === "add") {
    if (type === "project_post_map" || type === "project_map_backlink") return "Структурные блоки проекта создаются только автоматически";
    return "";
  }

  if (action === "property" && ["targetMapId", "targetSlotId", "mapId", "slots"].includes(String(key || ""))) {
    return "Связь и слоты управляются картой проекта";
  }

  // Required blocks may be edited, reordered, or nested like ordinary content.
  // Only removing or changing their block type is guarded.
  if (action === "move" || action === "property") return "";
  if (String(postHeading?.id || "") === protectedId) return "Заголовок поста проекта обязателен";
  if (isRoot && String(rootMap?.id || "") === protectedId) return "Карта проекта обязательна в первом посте";
  const node = findNode(active.messageAst, protectedId);
  const requiredBacklink = isRoot ? null : findBacklinkForMap(active.messageAst, rootMap?.props?.mapId);
  if (String(requiredBacklink?.id || "") === protectedId) return "Блок «Назад к карте» обязателен и привязан к карте проекта";
  return "";
}

function enforceLinearProjectStructure(project) {
  if (!Array.isArray(project.posts) || !project.posts.length) {
    const root = createPostRecord({ title: "Пост 1" });
    project.posts = [root];
  }
  project.structure ||= { mode: PROJECT_STRUCTURE_MODE };
  project.structure.mode = PROJECT_STRUCTURE_MODE;
  let root = getProjectRootPost(project);
  if (!root) root = project.posts[0];
  project.structure.rootPostId = root.id;

  // The first post must contain a Heading and the Project Map, but neither block
  // owns a fixed position. Authors may put other blocks before them or nest them
  // inside any compatible container. Normalization repairs missing requirements
  // without flattening, stripping, or reordering the document.
  root.messageAst = normalizeAst(root.messageAst);
  syncPostTitleFromHeading(root);
  root.title = cleanTitle(root.title, "Пост 1");
  ensureProjectHeading(root, root.title);

  const configuredMapId = String(project.structure.rootMapId || "");
  const oldMap = (configuredMapId && findFirstNode(root.messageAst, node => node?.type === "project_post_map" && String(node?.props?.mapId || "") === configuredMapId))
    || findFirstNode(root.messageAst, node => node?.type === "project_post_map");
  const mapId = String(oldMap?.props?.mapId || configuredMapId || `map_${randomUUID()}`);
  const map = oldMap && typeof oldMap === "object" ? oldMap : createProjectMap(mapId);
  if (!oldMap) root.messageAst.children.push(map);
  map.id ||= randomUUID();
  map.type = "project_post_map";
  map.children = [];
  map.props = {
    numbering: "numeric",
    emptyText: "Карта пока пуста",
    ...(map.props && typeof map.props === "object" ? map.props : {}),
    mapId
  };
  delete map.props.prefix;
  delete map.props.separator;
  project.structure.rootMapId = mapId;

  const postById = new Map(project.posts.filter(post => post !== root).map(post => [String(post.id), post]));
  const sourceSlots = Array.isArray(map.props.slots) ? map.props.slots : [];
  const orderedChildren = [];
  const used = new Set();
  for (const sourceSlot of sourceSlots) {
    const targetId = String(sourceSlot?.targetPostId || "");
    const post = postById.get(targetId);
    if (!post || used.has(targetId)) continue;
    used.add(targetId);
    orderedChildren.push({ post, slot: normalizeProjectSlot(sourceSlot, post) });
  }
  for (const post of postById.values()) {
    if (used.has(String(post.id))) continue;
    orderedChildren.push({ post, slot: normalizeProjectSlot(null, post) });
  }
  map.props.slots = orderedChildren.map(item => item.slot);

  for (const { post, slot } of orderedChildren) {
    post.messageAst = normalizeAst(post.messageAst);
    syncPostTitleFromHeading(post);
    post.title = cleanTitle(post.title, "Пост");
    post.messageAst = createChildProjectAst(post.title, mapId, slot.id, post.messageAst);
  }
  project.posts = [root, ...orderedChildren.map(item => item.post)];
}

function createRootProjectAst(title, mapId) {
  return {
    id: "root",
    type: "document",
    props: {},
    children: [createProjectHeading(title), createProjectMap(mapId)]
  };
}

function createProjectMap(mapId) {
  return {
    id: randomUUID(),
    type: "project_post_map",
    props: {
      mapId,
      slots: [],
      numbering: "numeric",
      emptyText: "Карта пока пуста"
    },
    children: []
  };
}

function createChildProjectAst(title, mapId, slotId, sourceAst = null) {
  const holder = { messageAst: sourceAst || createEmptyDocumentAst() };
  const heading = ensureProjectHeading(holder, title);
  const ast = holder.messageAst;
  if (heading && !String(heading.props?.text || "").trim()) {
    heading.props ||= {};
    heading.props.text = cleanTitle(title, "Пост");
  }

  // Reuse a Back to Map that already belongs to this Map so a move into a nested
  // container survives saving. If only the Map matches, promote that existing
  // block into the generated slot relation instead of inserting a duplicate.
  const existingBacklink = findMatchingBacklink(ast, mapId, slotId)
    || findBacklinkForMap(ast, mapId)
    || findManagedBacklinkForSlot(ast, slotId);
  const backlink = existingBacklink || {
    id: randomUUID(),
    type: "project_map_backlink",
    props: {},
    children: []
  };
  if (!existingBacklink) ast.children.push(backlink);
  backlink.type = "project_map_backlink";
  backlink.props = {
    ...(backlink.props && typeof backlink.props === "object" ? backlink.props : {}),
    targetMapId: mapId,
    targetSlotId: slotId,
    text: backlink.props?.text || "Назад",
    managedByMap: true
  };
  backlink.children = [];
  return ast;
}

function normalizeProjectSlot(sourceSlot, post) {
  return {
    id: String(sourceSlot?.id || `slot_${randomUUID()}`),
    targetPostId: String(post.id),
    text: cleanTitle(post.title, "Пост"),
    derivedFromPostId: String(post.id)
  };
}

function ensureProjectHeading(post, title) {
  post.messageAst = normalizeAst(post.messageAst);
  const heading = findFirstNode(post.messageAst, node => node?.type === "heading");
  if (heading) {
    heading.props ||= {};
    heading.children ||= [];
    return heading;
  }
  const created = createProjectHeading(cleanTitle(title, "Пост"));
  post.messageAst.children.push(created);
  return created;
}

function findNode(node, nodeId) {
  if (!node || typeof node !== "object") return null;
  if (String(node.id || "") === String(nodeId || "")) return node;
  for (const child of node.children || []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children || []) walkAst(child, visit);
}

function findFirstNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate?.(node)) return node;
  for (const child of node.children || []) {
    const found = findFirstNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findMatchingBacklink(node, mapId, slotId) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "project_map_backlink"
    && String(node.props?.targetMapId || "") === String(mapId)
    && String(node.props?.targetSlotId || "") === String(slotId)) return node;
  for (const child of node.children || []) {
    const found = findMatchingBacklink(child, mapId, slotId);
    if (found) return found;
  }
  return null;
}

function findBacklinkForMap(node, mapId) {
  const expectedMapId = String(mapId || "");
  if (!expectedMapId) return null;
  return findFirstNode(node, candidate => candidate?.type === "project_map_backlink"
    && String(candidate?.props?.targetMapId || "") === expectedMapId);
}

function findManagedBacklinkForSlot(node, slotId) {
  const expectedSlotId = String(slotId || "");
  if (!expectedSlotId) return null;
  return findFirstNode(node, candidate => candidate?.type === "project_map_backlink"
    && candidate?.props?.managedByMap === true
    && String(candidate?.props?.targetSlotId || "") === expectedSlotId);
}

function normalizeProject(value, fallbackId) {
  const source = value && typeof value === "object" ? structuredClone(value) : {};
  const now = Date.now();
  const id = String(source.id || fallbackId || makeId("project"));
  const posts = Array.isArray(source.posts) ? source.posts.map(normalizePost) : [];
  const project = {
    ...source,
    id,
    schemaVersion: Number(source.schemaVersion || PROJECT_SCHEMA_VERSION),
    title: cleanTitle(source.title, "Проект"),
    posts,
    createdAt: Number(source.createdAt || now),
    updatedAt: Number(source.updatedAt || source.createdAt || now)
  };
  if (isLinearProject(project)) enforceLinearProjectStructure(project);
  return project;
}

function normalizePost(value) {
  const source = value && typeof value === "object" ? structuredClone(value) : {};
  const now = Date.now();
  return {
    ...source,
    id: String(source.id || makeId("post")),
    title: cleanTitle(source.title, "Пост"),
    messageAst: normalizeAst(source.messageAst),
    schedule: source.schedule ?? null,
    publication: normalizePublication(source.publication),
    deployments: source.deployments && typeof source.deployments === "object" ? source.deployments : {},
    createdAt: Number(source.createdAt || now),
    updatedAt: Number(source.updatedAt || source.createdAt || now)
  };
}

function normalizePublication(value) {
  const state = ["draft", "scheduled", "published"].includes(value?.state) ? value.state : "draft";
  return { ...(value && typeof value === "object" ? value : {}), state };
}

function markPostProductionChanges(post) {
  if (post?.publication?.state !== "published" || !post?.deployments?.production?.messageId) return;
  post.publication ||= {};
  post.publication.hasUnappliedChanges = true;
}

function isPublishedProductionPost(post) {
  return post?.publication?.state === "published" || Boolean(post?.deployments?.production?.messageId);
}

function normalizeAst(value) {
  if (!value || typeof value !== "object") return createEmptyDocumentAst();
  const ast = structuredClone(value);
  ast.id = "root";
  ast.type = "document";
  ast.props = ast.props && typeof ast.props === "object" ? ast.props : {};
  ast.children = Array.isArray(ast.children) ? ast.children : [];
  return ast;
}

function cleanTitle(value, fallback) {
  const title = String(value ?? "").trim();
  return title || fallback;
}

function astSignature(ast) {
  try { return JSON.stringify(ast || null); }
  catch { return String(ast); }
}

function makeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}
