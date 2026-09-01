import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { ProjectDeploymentResolver, telegramMessageUrl } from "./ProjectDeploymentResolver.js?v=1.5.9";

const AUTO_SYNC_REASONS = new Set([
  "post-saved", "post-created", "post-renamed", "post-reordered", "post-deleted",
  "backlink-rebound", "saved", "graph-reconciled"
]);

export class ProjectPreviewSync {
  constructor({ store, compiler, validator, transport, events = null, editorSession = null, autoSyncDelay = 900 } = {}) {
    this.store = store;
    this.compiler = compiler;
    this.validator = validator;
    this.transport = transport;
    this.events = events;
    this.editorSession = editorSession;
    this.autoSyncDelay = autoSyncDelay;
    this.running = new Map();
    this.timers = new Map();
    this.resyncRequested = new Set();
    this.resyncAutomatic = new Map();
    this.resyncAffected = new Map();
    this.resyncFull = new Set();
    this.scheduledAffected = new Map();
    this.scheduledFull = new Set();
    this.unsubscribers = [];

    if (events?.on) {
      this.unsubscribers.push(
        events.on("project:changed", event => this.#onProjectChanged(event)),
        events.on("project:post-removed", event => this.#cleanupPost(event?.post, event?.projectId)),
        events.on("project:removed", event => this.#cleanupProject(event?.project))
      );
    }
  }

  // affectedPostIds === null means an explicit/full project sync. Automatic Editor
  // changes pass the edited post ids and are expanded only through ProjectIndex.
  sync(projectId, { automatic = false, affectedPostIds = null } = {}) {
    if (!projectId) return Promise.reject(new Error("Project id is required"));
    const affected = normalizePostIds(affectedPostIds);
    if (this.running.has(projectId)) {
      this.#queueResync(projectId, { automatic, affectedPostIds: affected });
      return this.running.get(projectId);
    }

    clearTimeout(this.timers.get(projectId));
    this.timers.delete(projectId);
    this.scheduledAffected.delete(projectId);
    this.scheduledFull.delete(projectId);

    const promise = this.#runLoop(projectId, automatic, affected)
      .catch(error => {
        this.events?.emit("project:preview-sync", { state: "error", projectId, error, message: error?.message || String(error) });
        throw error;
      })
      .finally(() => {
        this.running.delete(projectId);
        this.resyncRequested.delete(projectId);
        this.resyncAutomatic.delete(projectId);
        this.resyncAffected.delete(projectId);
        this.resyncFull.delete(projectId);
      });
    this.running.set(projectId, promise);
    return promise;
  }

  async remove(projectId) {
    if (!projectId) throw new Error("Project id is required");
    clearTimeout(this.timers.get(projectId));
    this.timers.delete(projectId);
    this.scheduledAffected.delete(projectId);
    this.scheduledFull.delete(projectId);
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Removal is deliberately best-effort and per-post. Telegram staging is a
    // projection/cache of Project state: an incomplete or manually modified channel
    // must never make the local Project graph impossible to clean up.
    const deployments = (project.posts || [])
      .map(post => ({ post, deployment: post.deployments?.preview }))
      .filter(item => item.deployment);
    this.events?.emit("project:preview-sync", { state: "removing", projectId, project: structuredClone(project), total: deployments.length, current: 0 });

    let current = 0;
    let removed = 0;
    let forgotten = 0;
    const failed = [];

    for (const item of deployments) {
      let action = "deleted";
      try {
        if (item.deployment?.messageId) {
          const deleted = await this.transport.deleteDeployment?.(item.deployment);
          // A deployment from another/old preview channel cannot be deleted through
          // the current transport, but explicit "remove deployment" must still be
          // able to forget that stale local projection record.
          if (deleted === false) {
            action = "forgotten_channel_mismatch";
            forgotten += 1;
          } else {
            removed += 1;
          }
        } else {
          // Malformed/incomplete local projection: there is nothing addressable in
          // Telegram, so only the local deployment record needs to be removed.
          action = "forgotten_incomplete";
          forgotten += 1;
        }

        // Clear only the processed post. If a later Telegram operation really fails,
        // already cleaned records stay clean while the failed record remains retryable.
        await this.store.setPostDeployment(projectId, item.post.id, "preview", null);
      } catch (error) {
        action = "failed";
        failed.push({ postId: item.post.id, error, message: error?.message || String(error) });
      }

      current += 1;
      const currentProject = await this.store.getProject(projectId);
      this.events?.emit("project:preview-sync", {
        state: "removing",
        projectId,
        project: currentProject ? structuredClone(currentProject) : null,
        postId: item.post.id,
        total: deployments.length,
        current,
        action,
        error: action === "failed" ? failed.at(-1)?.error : undefined,
        message: action === "failed" ? failed.at(-1)?.message : undefined
      });
    }

    const cleaned = await this.store.getProject(projectId);
    const remaining = (cleaned?.posts || []).filter(post => post.deployments?.preview).length;
    const state = failed.length ? "remove-partial" : "removed";
    this.events?.emit("project:preview-sync", {
      state,
      projectId,
      project: cleaned ? structuredClone(cleaned) : null,
      total: deployments.length,
      current,
      removed,
      forgotten,
      failed: failed.length,
      remaining
    });
    return { project: cleaned, removed, forgotten, failed, remaining, partial: failed.length > 0 };
  }

  async clearAllDeployments() {
    const projects = await this.store.listProjects();
    const deployed = projects.filter(project => hasPreviewDeployment(project));
    const results = [];
    for (const project of deployed) {
      const running = this.running.get(project.id);
      if (running) await running.catch(() => {});
      const result = await this.remove(project.id);
      results.push({ projectId: project.id, ...result });
      if (result.partial) {
        const error = new Error(`Не удалось полностью очистить выгрузку проекта «${project.title || project.id}»: осталось ${result.remaining}`);
        error.cleanupResults = results;
        throw error;
      }
    }
    return {
      projects: results,
      projectCount: results.length,
      removed: results.reduce((sum, result) => sum + Number(result.removed || 0), 0),
      forgotten: results.reduce((sum, result) => sum + Number(result.forgotten || 0), 0)
    };
  }

  schedule(projectId, { delay = this.autoSyncDelay, affectedPostIds = null } = {}) {
    if (!projectId) return;
    const affected = normalizePostIds(affectedPostIds);
    this.#mergeScheduled(projectId, affected);
    clearTimeout(this.timers.get(projectId));
    if (this.running.has(projectId)) {
      this.#queueResync(projectId, { automatic: true, affectedPostIds: affected });
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(projectId);
      const full = this.scheduledFull.delete(projectId);
      const ids = [...(this.scheduledAffected.get(projectId) || new Set())];
      this.scheduledAffected.delete(projectId);
      this.sync(projectId, { automatic: true, affectedPostIds: full ? null : ids }).catch(() => {});
    }, Math.max(100, Number(delay) || this.autoSyncDelay));
    this.timers.set(projectId, timer);
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.scheduledAffected.clear();
    this.scheduledFull.clear();
    for (const off of this.unsubscribers.splice(0)) off?.();
  }

  async #runLoop(projectId, automatic, affectedPostIds) {
    let result = null;
    let nextAutomatic = automatic;
    let nextAffected = affectedPostIds;
    do {
      this.resyncRequested.delete(projectId);
      this.resyncAutomatic.delete(projectId);
      this.resyncAffected.delete(projectId);
      this.resyncFull.delete(projectId);
      result = nextAffected === null
        ? await this.#syncFull(projectId, { automatic: nextAutomatic })
        : await this.#syncAffected(projectId, nextAffected, { automatic: nextAutomatic });

      nextAutomatic = this.resyncAutomatic.get(projectId) ?? true;
      nextAffected = this.resyncFull.has(projectId)
        ? null
        : [...(this.resyncAffected.get(projectId) || new Set())];
    } while (this.resyncRequested.has(projectId));
    return result;
  }

  async #syncFull(projectId, { automatic = false } = {}) {
    let { project, index } = await this.#loadValidated(projectId, automatic);
    if (!project) return index; // validation waiting result

    const channel = await this.transport.getChannel();
    this.#emit("materializing", project, { total: project.posts.length, channel, automatic, full: true });

    // Pass 1: every logical post receives a real staging Telegram identity.
    for (let i = 0; i < project.posts.length; i += 1) {
      const post = project.posts[i];
      index = new ProjectIndex(project);
      const resolver = new ProjectDeploymentResolver({ project, index, deployment: "preview" });
      const tree = this.compiler.compilePost(project, post.id, { deployment: "preview", index, resolver });
      const envelope = this.transport.render(tree);
      const previous = post.deployments?.preview;
      const sameChannel = Number(previous?.chatId) === Number(channel.chatId) && previous?.messageId;
      const result = sameChannel
        ? await this.transport.syncEnvelope(previous.messageId, envelope)
        : { action: "sent", message: await this.transport.sendEnvelope(envelope) };
      const messageId = Number(result.message?.message_id || result.messageId || previous?.messageId);
      if (!messageId) throw new Error(`Telegram не вернул message_id для ${post.title || post.id}`);
      project = await this.#saveDeployment(project, post.id, channel.chatId, messageId);
      this.#emit("materializing", project, { current: i + 1, total: project.posts.length, postId: post.id, action: result.action || "sent", channel, automatic, full: true });
    }

    project = await this.#resolvePosts(project, project.posts.map(post => post.id), channel, { automatic, full: true });
    this.#emit("synced", project, { total: project.posts.length, channel, automatic, full: true, affectedPostIds: project.posts.map(post => post.id) });
    return { project, channel, postCount: project.posts.length, affectedPostIds: project.posts.map(post => post.id), full: true };
  }

  async #syncAffected(projectId, seedPostIds, { automatic = true } = {}) {
    let loaded = await this.#loadValidated(projectId, automatic);
    if (!loaded.project) return loaded.index;
    let { project, index } = loaded;
    const existingIds = new Set(project.posts.map(post => String(post.id)));
    const seeds = normalizePostIds(seedPostIds).filter(id => existingIds.has(id));
    if (!seeds.length) return { project, skipped: "no-affected-posts", affectedPostIds: [] };

    let affectedPostIds = index.dependencyClosure(seeds).filter(id => existingIds.has(id));
    const channel = await this.transport.getChannel();
    this.#emit("updating", project, { total: affectedPostIds.length, channel, automatic, full: false, affectedPostIds });

    // Materialize only posts in the affected dependency closure that do not yet have
    // a usable identity in the current preview channel. Existing messages are edited
    // once in the resolution phase below.
    for (let i = 0; i < affectedPostIds.length; i += 1) {
      const postId = affectedPostIds[i];
      const post = project.posts.find(item => item.id === postId);
      if (!post) continue;
      const previous = post.deployments?.preview;
      const sameChannel = Number(previous?.chatId) === Number(channel.chatId) && previous?.messageId;
      if (sameChannel) continue;
      index = new ProjectIndex(project);
      const resolver = new ProjectDeploymentResolver({ project, index, deployment: "preview" });
      const tree = this.compiler.compilePost(project, post.id, { deployment: "preview", index, resolver });
      const envelope = this.transport.render(tree);
      const message = await this.transport.sendEnvelope(envelope);
      const messageId = Number(message?.message_id);
      if (!messageId) throw new Error(`Telegram не вернул message_id для ${post.title || post.id}`);
      project = await this.#saveDeployment(project, post.id, channel.chatId, messageId);
      // A newly materialized post has acquired a Telegram identity. Backlinks to Maps
      // hosted by it (and Map links to it) now need their compiled URL refreshed.
      const identityIndex = new ProjectIndex(project);
      for (const dependentId of identityIndex.identityDependentsForPost(post.id)) {
        if (!affectedPostIds.includes(dependentId)) affectedPostIds.push(dependentId);
      }
      this.#emit("updating", project, { current: i + 1, total: affectedPostIds.length, postId: post.id, action: "sent", channel, automatic, full: false, affectedPostIds });
    }

    // Rebuild the closure after materialization: graph reconciliation may have added
    // a backlink/map dependency while the request was waiting in the autosync queue.
    index = new ProjectIndex(project);
    affectedPostIds = index.dependencyClosure(affectedPostIds).filter(id => project.posts.some(post => post.id === id));
    project = await this.#resolvePosts(project, affectedPostIds, channel, { automatic, full: false });
    this.#emit("synced", project, { total: affectedPostIds.length, channel, automatic, full: false, affectedPostIds });
    return { project, channel, postCount: affectedPostIds.length, affectedPostIds, full: false };
  }

  async #resolvePosts(project, postIds, channel, { automatic, full }) {
    let ids = [...new Set(postIds.map(String))];
    for (let pass = 1; pass <= 3; pass += 1) {
      let identityChanged = false;
      const identityInvalidations = new Set();
      const index = new ProjectIndex(project);
      if (!full) ids = index.contentClosure(ids).filter(id => project.posts.some(post => post.id === id));
      const resolver = new ProjectDeploymentResolver({ project, index, deployment: "preview" });
      this.#emit("resolving", project, { pass, total: ids.length, channel, automatic, full, affectedPostIds: ids });
      for (let i = 0; i < ids.length; i += 1) {
        const postId = ids[i];
        const post = project.posts.find(item => item.id === postId);
        const deployment = post?.deployments?.preview;
        if (!post || !deployment?.messageId) continue;
        const tree = this.compiler.compilePost(project, post.id, { deployment: "preview", index, resolver });
        const envelope = this.transport.render(tree);
        const result = await this.transport.syncEnvelope(deployment.messageId, envelope);
        const messageId = Number(result.message?.message_id || result.messageId || deployment.messageId);
        if (messageId !== Number(deployment.messageId)) {
          identityChanged = true;
          for (const dependentId of index.identityDependentsForPost(post.id)) identityInvalidations.add(dependentId);
          project = await this.#saveDeployment(project, post.id, channel.chatId, messageId);
        }
        this.#emit("resolving", project, { pass, current: i + 1, total: ids.length, postId: post.id, action: result.action, channel, automatic, full, affectedPostIds: ids });
      }
      if (identityInvalidations.size) {
        ids = [...new Set([...ids, ...identityInvalidations])];
      }
      if (!identityChanged) break;
    }
    return project;
  }

  async #loadValidated(projectId, automatic) {
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const index = new ProjectIndex(project);
    const sourceErrors = this.validator?.validate?.(project, index) || [];
    if (!sourceErrors.length) return { project, index };
    if (automatic) {
      this.#emit("waiting", project, { validationErrors: sourceErrors, total: project.posts.length });
      return { project: null, index: { project, skipped: "invalid", validationErrors: sourceErrors } };
    }
    const error = new Error(`Project не прошёл source validation: ${sourceErrors.length} ошибок`);
    error.validationErrors = sourceErrors;
    throw error;
  }

  async #saveDeployment(project, postId, chatId, messageId) {
    return this.store.setPostDeployment(project.id, postId, "preview", {
      chatId: Number(chatId),
      messageId: Number(messageId),
      url: telegramMessageUrl(chatId, messageId),
      syncedAt: Date.now()
    });
  }

  #onProjectChanged(event) {
    if (!AUTO_SYNC_REASONS.has(event?.reason)) return;
    const project = event?.project;
    if (!project?.id || !hasPreviewDeployment(project)) return;
    const affected = normalizePostIds(event?.affectedPostIds || (event?.postId ? [event.postId] : null));
    // Generic project save has no entity-level provenance and therefore remains a full
    // sync. Editor/post and graph events carry precise affected post ids.
    this.schedule(project.id, { affectedPostIds: affected });
  }

  #mergeScheduled(projectId, affectedPostIds) {
    if (affectedPostIds === null) {
      this.scheduledFull.add(projectId);
      this.scheduledAffected.delete(projectId);
      return;
    }
    if (this.scheduledFull.has(projectId)) return;
    if (!this.scheduledAffected.has(projectId)) this.scheduledAffected.set(projectId, new Set());
    const target = this.scheduledAffected.get(projectId);
    for (const postId of affectedPostIds) target.add(postId);
  }

  #queueResync(projectId, { automatic, affectedPostIds }) {
    this.resyncRequested.add(projectId);
    // An explicit user sync upgrades any queued automatic retry to explicit semantics.
    this.resyncAutomatic.set(projectId, this.resyncAutomatic.get(projectId) !== false && automatic);
    if (affectedPostIds === null) {
      this.resyncFull.add(projectId);
      this.resyncAffected.delete(projectId);
      return;
    }
    if (this.resyncFull.has(projectId)) return;
    if (!this.resyncAffected.has(projectId)) this.resyncAffected.set(projectId, new Set());
    const target = this.resyncAffected.get(projectId);
    for (const postId of affectedPostIds) target.add(postId);
  }

  async #cleanupPost(post, projectId = null) {
    const deployment = post?.deployments?.preview;
    if (!deployment?.messageId) return;
    try {
      const deleted = await this.transport.deleteDeployment?.(deployment);
      this.events?.emit("project:preview-sync", {
        state: "cleanup",
        projectId,
        postId: post.id,
        action: deleted === false ? "skipped_channel_mismatch" : "deleted"
      });
    } catch (error) {
      this.events?.emit("project:preview-sync", { state: "cleanup-error", projectId, postId: post.id, error, message: error?.message || String(error) });
    }
  }

  async #cleanupProject(project) {
    for (const post of project?.posts || []) await this.#cleanupPost(post, project?.id);
  }

  #emit(state, project, extra = {}) {
    this.events?.emit("project:preview-sync", { state, projectId: project?.id, project: project ? structuredClone(project) : null, ...extra });
  }
}

function normalizePostIds(value) {
  if (value == null) return null;
  return [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String))];
}

function hasPreviewDeployment(project) {
  return (project?.posts || []).some(post => post.deployments?.preview?.messageId);
}
