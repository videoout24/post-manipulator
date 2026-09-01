import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { ProjectDeploymentResolver, telegramMessageUrl } from "./ProjectDeploymentResolver.js?v=1.5.9";
import { getProjectPostPublicationEligibility } from "./ProjectPublicationEligibility.js?v=1.5.9";
import { productionContentSnapshot } from "./ProjectPublicationState.js?v=1.5.9";
import { isLinearProject } from "./ProjectStore.js?v=1.7.6";
import { PUBLICATION_DELETE_WINDOW_MS, isPublicationDeleteAvailable } from "../telegram/PublicationService.js?v=1.5.9";

const MAX_TIMER_DELAY = 2_147_000_000;
const SCHEDULE_RETRY_DELAY = 60_000;

/*
  Production projection for a Project graph.

  Project memory remains the source of truth. A successful production projection
  also receives a normal `publications` record, which lets the existing journal,
  reactions and comments UI treat Project posts exactly like standalone posts.
*/
export class ProjectPublicationService {
  constructor({ db, store, compiler, validator, client, renderer, targets, events = null, editorSession = null } = {}) {
    Object.assign(this, { db, store, compiler, validator, client, renderer, targets, events, editorSession });
    this.scheduleTimers = new Map();
    this.structureSyncs = new Map();
    this.unsubscribers = [
      this.events?.on?.("project:changed", event => {
        this.#syncProjectSchedules(event?.project);
        if (["post-reordered", "post-deleted"].includes(event?.reason)) this.#queueStructureSync(event);
      }),
      this.events?.on?.("project:post-removed", event => this.#cleanupRemovedScheduledPost(event).catch(() => {})),
      this.events?.on?.("project:removed", event => this.#cleanupRemovedProjectSchedules(event).catch(() => {}))
    ].filter(Boolean);
  }

  async initialize() {
    for (const project of await this.store.listProjects()) this.#syncProjectSchedules(project);
  }

  stop() {
    for (const entry of this.scheduleTimers.values()) clearTimeout(entry.timer);
    this.scheduleTimers.clear();
    this.structureSyncs.clear();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  async publishProject(projectId, targetChatId, { commentsEnabled = true } = {}) {
    if (!projectId) throw new Error("Project id is required");
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    let project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    const target = await this.#requireTarget(targetChatId);
    this.#validate(project);
    this.#assertCommentsConfig(target, commentsEnabled);
    this.#assertSingleProductionTarget(project, target.chatId);

    const order = publicationOrder(project);
    this.#emit("publishing", project, { target, total: order.length, current: 0, postIds: order });
    try {
      // Pass 1 materializes identities. Map hosts are deliberately first, then the
      // remaining posts keep their Project order. The final pass resolves every
      // Map/Backlink once all production message IDs exist.
      for (let i = 0; i < order.length; i += 1) {
        const result = await this.#syncPost(project, order[i], target, { allowCreate: true, commentsEnabled });
        project = result.project;
        this.#emit("publishing", project, {
          target,
          total: order.length,
          current: i + 1,
          postId: order[i],
          action: result.action,
          postIds: order
        });
      }
      project = await this.#syncPosts(project, order, target, { allowCreate: false, commentsEnabled, phase: "resolving" });
      this.#emit("published", project, { target, total: order.length, current: order.length, postIds: order });
      return { project, target, postIds: order };
    } catch (error) {
      const partial = await this.store.getProject(projectId).catch(() => project);
      this.#emit("partial", partial, {
        target,
        total: order.length,
        postIds: order,
        error,
        message: error?.message || String(error)
      });
      throw error;
    }
  }

  async applyChanges(projectId, postId) {
    if (!projectId || !postId) throw new Error("Не указан Project post");
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    let project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    this.#validate(project);
    const post = project.posts.find(item => String(item.id) === String(postId));
    const deployment = post?.deployments?.production;
    if (!deployment?.chatId || !deployment?.messageId) {
      throw new Error("Этот пост ещё не опубликован в production");
    }
    const target = await this.#requireTarget(deployment.chatId);
    const index = new ProjectIndex(project);
    const affected = index.contentClosure([post.id])
      .filter(id => project.posts.some(item => item.id === id && item.deployments?.production?.messageId));
    this.#emit("updating", project, { target, total: affected.length, current: 0, postIds: affected });
    project = await this.#syncPosts(project, affected, target, { allowCreate: false, phase: "updating" });
    this.#emit("updated", project, { target, total: affected.length, current: affected.length, postIds: affected });
    return { project, target, postIds: affected };
  }

  async syncPublishedStructure(projectId, affectedPostIds = []) {
    if (!projectId) throw new Error("Project id is required");
    let project = await this.store.getProject(projectId);
    if (!project) return { project: null, postIds: [], skipped: "project-missing" };
    const requested = new Set((affectedPostIds || []).filter(Boolean).map(String));
    const postIds = project.posts
      .filter(post => requested.has(String(post.id)) && post.deployments?.production?.messageId)
      .map(post => String(post.id));
    if (!postIds.length) return { project, postIds, skipped: "no-published-structure" };

    this.#validate(project);
    const chatIds = new Set(postIds.map(id => Number(project.posts.find(post => String(post.id) === id)?.deployments?.production?.chatId || 0)).filter(Boolean));
    if (chatIds.size !== 1) throw new Error("Структурные посты Project опубликованы в разных каналах");
    const target = await this.#requireTarget([...chatIds][0]);
    this.#emit("updating", project, { target, total: postIds.length, current: 0, postIds, structural: true });
    project = await this.#syncPosts(project, postIds, target, { allowCreate: false, phase: "updating" });
    this.#emit("updated", project, { target, total: postIds.length, current: postIds.length, postIds, structural: true });
    return { project, target, postIds };
  }

  async publishPost(projectId, postId, targetChatId, { commentsEnabled = true } = {}) {
    if (!projectId || !postId) throw new Error("Не указан Project post");
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    let project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post) throw new Error("Пост проекта не найден");
    const target = await this.#requireTarget(targetChatId);
    this.#validate(project);
    this.#assertCommentsConfig(target, commentsEnabled);
    this.#assertSingleProductionTarget(project, target.chatId);
    const eligibility = getProjectPostPublicationEligibility(project, post.id, new ProjectIndex(project));
    if (!eligibility.eligible) {
      throw new Error("Сначала опубликуйте Post Map, от которого зависит этот пост");
    }

    this.#emit("publishing", project, { target, total: 1, current: 0, postId: post.id, postIds: [post.id] });
    try {
      const result = await this.#syncPost(project, post.id, target, { allowCreate: true, commentsEnabled });
      project = result.project;
      // A newly published target turns the dependent Map entries into Telegram
      // links. Refresh the minimum published closure, not the full Project.
      const index = new ProjectIndex(project);
      const dependents = index.contentClosure([post.id])
        .filter(id => id !== String(post.id))
        .filter(id => project.posts.some(item => item.id === id && item.deployments?.production?.messageId));
      if (dependents.length) project = await this.#syncPosts(project, dependents, target, { allowCreate: false, phase: "resolving" });
      this.#emit("published", project, { target, total: 1, current: 1, postId: post.id, postIds: [post.id], action: result.action });
      return { project, target, postIds: [post.id] };
    } catch (error) {
      const partial = await this.store.getProject(projectId).catch(() => project);
      this.#emit("partial", partial, { target, total: 1, postId: post.id, postIds: [post.id], error, message: error?.message || String(error) });
      throw error;
    }
  }

  async schedulePost(projectId, postId, targetChatId, { scheduledAt, commentsEnabled = true } = {}) {
    if (!projectId || !postId) throw new Error("Не указан Project post");
    const publishAt = Number(scheduledAt || 0);
    if (!Number.isFinite(publishAt) || publishAt <= Date.now()) {
      throw new Error("Укажите время отложенной публикации в будущем");
    }
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    let project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post) throw new Error("Пост проекта не найден");
    if (post.deployments?.production?.messageId) throw new Error("Этот пост уже опубликован");
    const target = await this.#requireTarget(targetChatId);
    this.#validate(project);
    this.#assertCommentsConfig(target, commentsEnabled);
    this.#assertSingleProductionTarget(project, target.chatId);
    const eligibility = getProjectPostPublicationEligibility(project, post.id, new ProjectIndex(project));
    if (!eligibility.eligible) {
      throw new Error("Сначала опубликуйте Post Map, от которого зависит этот пост");
    }

    const schedule = {
      scheduledAt: publishAt,
      chatId: Number(target.chatId),
      commentsEnabled: Boolean(commentsEnabled),
      createdAt: Date.now()
    };
    project = await this.store.savePostSchedule(project.id, post.id, schedule);
    await this.#writeScheduledPublicationRecord(project, post.id, target, schedule);
    const refreshedPostIds = await this.#refreshPublishedMapDependents(project, post.id, target, "updating");
    if (refreshedPostIds.length) project = await this.store.getProject(project.id);
    this.#armSchedule(project.id, post.id, schedule);
    const postIds = [post.id, ...refreshedPostIds];
    this.#emit("scheduled", project, { target, total: postIds.length, current: postIds.length, postId: post.id, postIds, scheduledAt: publishAt });
    return { project, target, postIds, scheduledAt: publishAt };
  }

  async cancelPostSchedule(projectId, postId) {
    if (!projectId || !postId) throw new Error("Не указан Project post");
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post?.schedule || post.publication?.state !== "scheduled") {
      throw new Error("Этот Project post не отложен");
    }
    const target = await this.#requireTarget(post.schedule.chatId);
    this.#clearSchedule(project.id, post.id);
    let nextProject = await this.store.clearPostSchedule(project.id, post.id);
    await this.db.delete("publications", projectPublicationId(project.id, post.id));
    await this.#emitPublicationsChanged();
    const refreshedPostIds = await this.#refreshPublishedMapDependents(nextProject, post.id, target, "updating");
    if (refreshedPostIds.length) nextProject = await this.store.getProject(nextProject.id);
    const postIds = [post.id, ...refreshedPostIds];
    this.#emit("schedule-cancelled", nextProject, { target, postId: post.id, postIds });
    return { project: nextProject, target, postIds };
  }

  async unpublishPost(projectId, postId) {
    const context = await this.#getPublishedPostContext(projectId, postId);
    if (!isPublicationDeleteAvailable(context.publication || { publishedAt: context.deployment.publishedAt })) {
      throw new Error("48-часовой срок удаления публикации в Telegram истёк");
    }
    this.#emit("unpublishing", context.project, { target: context.target, total: 1, current: 0, postId: context.post.id, postIds: [context.post.id] });
    try {
      try {
        await this.client.deleteMessage(context.deployment.chatId, context.deployment.messageId);
      } catch (error) {
        // A manually deleted Telegram message is already absent from production and
        // must not block local Project cleanup.
        if (!error?.isMessageMissing?.()) throw error;
      }
      const project = await this.#discardPostProjection(context);
      this.#emit("unpublished", project, { target: context.target, total: 1, current: 1, postId: context.post.id, postIds: [context.post.id] });
      return { project, target: context.target, postIds: [context.post.id] };
    } catch (error) {
      const partial = await this.store.getProject(projectId).catch(() => context.project);
      this.#emit("partial", partial, { target: context.target, total: 1, postId: context.post.id, postIds: [context.post.id], error, message: error?.message || String(error) });
      throw error;
    }
  }

  async checkExpiredUnpublish(projectId, postId) {
    const context = await this.#getPublishedPostContext(projectId, postId);
    if (isPublicationDeleteAvailable(context.publication || { publishedAt: context.deployment.publishedAt })) {
      throw new Error("Для этого Project post ещё доступно обычное удаление");
    }
    try {
      await this.client.deleteMessage(context.deployment.chatId, context.deployment.messageId);
    } catch (error) {
      if (error?.isMessageMissing?.()) return { ...context, remoteState: "missing" };
      if (error?.isMessageDeleteForbidden?.()) return { ...context, remoteState: "present" };
      throw error;
    }
    const project = await this.#discardPostProjection(context);
    this.#emit("unpublished", project, { target: context.target, total: 1, current: 1, postId: context.post.id, postIds: [context.post.id] });
    return { ...context, project, remoteState: "deleted" };
  }

  async discardPostProjection(projectId, postId) {
    const context = await this.#getPublishedPostContext(projectId, postId);
    const project = await this.#discardPostProjection(context);
    this.#emit("unpublished", project, {
      target: context.target,
      total: 1,
      current: 1,
      postId: context.post.id,
      postIds: [context.post.id],
      localOnly: true
    });
    return { project, target: context.target, postIds: [context.post.id] };
  }

  async #getPublishedPostContext(projectId, postId) {
    if (!projectId || !postId) throw new Error("Не указан Project post");
    if (this.editorSession?.activeProjectId === projectId) await this.editorSession.flush();
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error("Проект не найден");
    const post = project.posts.find(item => String(item.id) === String(postId));
    const deployment = post?.deployments?.production;
    if (!post || !deployment?.chatId || !deployment?.messageId) {
      throw new Error("Этот Project post не опубликован");
    }
    const [publication, target] = await Promise.all([
      this.db.get("publications", projectPublicationId(project.id, post.id), null),
      this.#requireTarget(deployment.chatId)
    ]);
    return { project, post, deployment, publication, target };
  }

  async #discardPostProjection({ project, post, target }) {
    let nextProject = await this.store.clearPostProduction(project.id, post.id);
    await this.db.delete("publications", projectPublicationId(nextProject.id, post.id));
    await this.#emitPublicationsChanged();

    const index = new ProjectIndex(nextProject);
    const dependents = [...new Set([
      ...index.contentClosure([post.id]),
      ...index.identityDependentsForPost(post.id)
    ])]
      .filter(id => id !== String(post.id))
      .filter(id => nextProject.posts.some(item => item.id === id && item.deployments?.production?.messageId));
    if (dependents.length) nextProject = await this.#syncPosts(nextProject, dependents, target, { allowCreate: false, phase: "resolving" });
    return nextProject;
  }

  async #syncPosts(project, postIds, target, { allowCreate = false, commentsEnabled = undefined, phase = "updating" } = {}) {
    const queue = [...new Set((postIds || []).map(String))];
    let current = project;
    for (let i = 0; i < queue.length; i += 1) {
      const result = await this.#syncPost(current, queue[i], target, { allowCreate, commentsEnabled });
      current = result.project;
      this.#emit(phase, current, {
        target,
        total: queue.length,
        current: i + 1,
        postId: queue[i],
        action: result.action,
        postIds: queue
      });
    }
    return current;
  }

  // A Map renders the publication state and planned time of each target post.
  // Scheduling therefore changes the already-published Map's compiled content
  // even though the target post itself has no Telegram message yet.
  async #refreshPublishedMapDependents(project, postId, target, phase = "updating") {
    const index = new ProjectIndex(project);
    const dependentIds = index.contentClosure([postId])
      .filter(id => String(id) !== String(postId))
      .filter(id => project.posts.some(item => String(item.id) === String(id) && item.deployments?.production?.messageId));
    if (!dependentIds.length) return [];
    await this.#syncPosts(project, dependentIds, target, { allowCreate: false, phase });
    return dependentIds;
  }

  async #syncPost(project, postId, target, { allowCreate = false, commentsEnabled = undefined } = {}) {
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post) throw new Error(`Project post не найден: ${postId}`);
    const previous = post.deployments?.production || null;
    if (previous?.chatId && Number(previous.chatId) !== Number(target.chatId)) {
      throw new Error("Production-канал уже отличается от выбранного");
    }
    if (!previous?.messageId && !allowCreate) {
      throw new Error(`У поста «${post.title || post.id}» отсутствует production-проекция`);
    }

    const index = new ProjectIndex(project);
    const resolver = new ProjectDeploymentResolver({ project, index, deployment: "production" });
    const tree = this.compiler.compilePost(project, post.id, { deployment: "production", index, resolver });
    const envelope = this.renderer.renderEnvelope(tree);
    const result = await this.#sendOrEdit(previous, target, envelope, { allowCreate });
    const messageId = Number(result.messageId || result.message?.message_id || previous?.messageId || 0);
    if (!messageId) throw new Error(`Telegram не вернул message_id для «${post.title || post.id}»`);

    const publishedAt = Number(result.message?.date || previous?.publishedAt || post.publication?.publishedAt || Date.now() / 1000) * 1000;
    const deployment = {
      chatId: Number(target.chatId),
      messageId,
      url: telegramMessageUrl(target.chatId, messageId),
      publishedAt,
      syncedAt: Date.now()
    };
    const nextProject = await this.store.savePostProduction(project.id, post.id, {
      deployment,
      publishedAt,
      productionContentSnapshot: productionContentSnapshot(tree.toJSON())
    });
    await this.#writePublicationRecord(nextProject, post.id, target, tree.toJSON(), deployment, publishedAt, commentsEnabled);
    return { project: nextProject, action: result.action };
  }

  async #sendOrEdit(previous, target, envelope, { allowCreate }) {
    if (previous?.messageId) {
      try {
        const message = await this.client.editRichMessage({
          chatId: target.chatId,
          messageId: Number(previous.messageId),
          richMessage: envelope.richMessage,
          replyMarkup: envelope.replyMarkup
        });
        return { action: "edited", message, messageId: Number(previous.messageId) };
      } catch (error) {
        if (error?.isNotModified?.()) return { action: "unchanged", messageId: Number(previous.messageId) };
        if (!error?.isMessageMissing?.()) throw error;
        if (!allowCreate) throw error;
      }
    }
    if (!allowCreate) throw new Error("Production message не найден");
    const message = await this.client.sendRichMessage({
      chatId: target.chatId,
      richMessage: envelope.richMessage,
      replyMarkup: envelope.replyMarkup,
      disableNotification: false
    });
    return { action: previous?.messageId ? "recreated" : "sent", message, messageId: Number(message?.message_id) };
  }

  async #writePublicationRecord(project, postId, target, messageAst, deployment, publishedAt, commentsEnabled = undefined) {
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post) throw new Error(`Project post не найден: ${postId}`);
    const id = projectPublicationId(project.id, post.id);
    const existing = await this.db.get("publications", id, null);
    const record = {
      ...(existing || {}),
      id,
      source: {
        kind: "project",
        projectId: String(project.id),
        postId: String(post.id),
        title: post.title || "Пост проекта",
        projectTitle: project.title || "Проект"
      },
      messageAst: structuredClone(messageAst),
      target: structuredClone(target),
      chatId: Number(deployment.chatId),
      messageId: Number(deployment.messageId),
      publishedAt: Number(publishedAt || Date.now()),
      scheduledAt: null,
      editedAt: existing?.messageId ? Date.now() : null,
      deleteUntil: Number(existing?.deleteUntil || publishedAt + PUBLICATION_DELETE_WINDOW_MS),
      commentsEnabled: target.type === "channel"
        && Boolean(target.commentsEnabled)
        && (commentsEnabled ?? existing?.commentsEnabled ?? true),
      discussionChatId: target.linkedDiscussionChatId || null,
      discussionUsername: target.linkedDiscussionUsername || "",
      discussionMessageId: existing?.discussionMessageId || null,
      commentsDisabled: Boolean(existing?.commentsDisabled),
      pinned: Boolean(existing?.pinned),
      pinnedAt: existing?.pinned ? (existing.pinnedAt || null) : null,
      commentMessageIds: existing?.commentMessageIds || [],
      commentCount: Number(existing?.commentCount || 0),
      reactionCount: Number(existing?.reactionCount || 0),
      reactions: existing?.reactions || [],
      reactionActors: existing?.reactionActors || {}
    };
    await this.db.put("publications", record.id, record);
    this.events?.emit("telegram:project-publication-record", structuredClone(record));
    await this.#emitPublicationsChanged();
    return record;
  }

  async #writeScheduledPublicationRecord(project, postId, target, schedule) {
    const post = project.posts.find(item => String(item.id) === String(postId));
    if (!post) throw new Error(`Project post не найден: ${postId}`);
    const id = projectPublicationId(project.id, post.id);
    const record = {
      id,
      source: {
        kind: "project",
        projectId: String(project.id),
        postId: String(post.id),
        title: post.title || "Пост проекта",
        projectTitle: project.title || "Проект"
      },
      messageAst: structuredClone(post.messageAst),
      target: structuredClone(target),
      chatId: Number(target.chatId),
      messageId: null,
      publishedAt: null,
      scheduledAt: Number(schedule.scheduledAt),
      deleteUntil: null,
      commentsEnabled: target.type === "channel" && Boolean(target.commentsEnabled) && Boolean(schedule.commentsEnabled),
      discussionChatId: target.linkedDiscussionChatId || null,
      discussionUsername: target.linkedDiscussionUsername || "",
      discussionMessageId: null,
      commentsDisabled: false,
      pinned: false,
      pinnedAt: null,
      commentMessageIds: [],
      commentCount: 0,
      reactionCount: 0,
      reactions: [],
      reactionActors: {}
    };
    await this.db.put("publications", record.id, record);
    await this.#emitPublicationsChanged();
    return record;
  }

  async #requireTarget(chatId) {
    const target = (await this.targets.list()).find(item => Number(item.chatId) === Number(chatId));
    if (!target || target.status !== "ready") throw new Error("Канал или группа недоступны для публикации");
    return target;
  }

  #assertSingleProductionTarget(project, chatId) {
    const targets = new Set((project.posts || [])
      .map(post => Number(post.deployments?.production?.chatId || post.schedule?.chatId || 0))
      .filter(Boolean));
    if (targets.size > 1) throw new Error("В Project обнаружено несколько production-каналов");
    if (targets.size === 1 && !targets.has(Number(chatId))) {
      throw new Error("Project уже опубликован в другом канале или группе");
    }
  }

  #assertCommentsConfig(target, commentsEnabled) {
    if (target.type === "channel" && target.commentsEnabled && commentsEnabled === false && !target.discussionRights?.canDelete) {
      throw new Error("Для отключения комментариев боту нужно право удаления сообщений в группе обсуждения");
    }
  }

  #validate(project) {
    const errors = this.validator?.validate?.(project, new ProjectIndex(project)) || [];
    if (!errors.length) return;
    const error = new Error(`Project не прошёл проверку: ${errors.length} ошибок`);
    error.validationErrors = errors;
    throw error;
  }

  async #emitPublicationsChanged() {
    const rows = await this.db.all("publications");
    const publications = rows.map(row => row.value)
      .sort((a, b) => Number(b?.publishedAt || b?.scheduledAt || 0) - Number(a?.publishedAt || a?.scheduledAt || 0));
    this.events?.emit("telegram:publications-changed", publications);
  }

  #syncProjectSchedules(project) {
    if (!project?.id) return;
    const active = new Set();
    for (const post of project.posts || []) {
      const schedule = post?.publication?.state === "scheduled" ? post.schedule : null;
      if (!schedule?.scheduledAt || !schedule?.chatId) continue;
      active.add(scheduleKey(project.id, post.id));
      this.#armSchedule(project.id, post.id, schedule);
    }
    for (const key of this.scheduleTimers.keys()) {
      if (key.startsWith(`${project.id}:`) && !active.has(key)) this.#clearScheduleByKey(key);
    }
  }

  #clearProjectSchedules(projectId) {
    for (const key of this.scheduleTimers.keys()) {
      if (key.startsWith(`${projectId}:`)) this.#clearScheduleByKey(key);
    }
  }

  #queueStructureSync({ projectId, affectedPostIds = [] } = {}) {
    if (!projectId) return;
    const previous = this.structureSyncs.get(projectId) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.syncPublishedStructure(projectId, affectedPostIds));
    this.structureSyncs.set(projectId, current);
    current.catch(error => {
      this.store.getProject(projectId).then(project => {
        this.#emit("partial", project, {
          postIds: (affectedPostIds || []).map(String),
          structural: true,
          error,
          message: error?.message || String(error)
        });
      }).catch(() => {});
    }).finally(() => {
      if (this.structureSyncs.get(projectId) === current) this.structureSyncs.delete(projectId);
    });
  }

  async #cleanupRemovedScheduledPost({ projectId, post } = {}) {
    if (!projectId || !post?.id) return;
    this.#clearSchedule(projectId, post.id);
    const id = projectPublicationId(projectId, post.id);
    const record = await this.db.get("publications", id, null);
    if (!record?.scheduledAt) return;
    await this.db.delete("publications", id);
    await this.#emitPublicationsChanged();
  }

  async #cleanupRemovedProjectSchedules({ projectId } = {}) {
    if (!projectId) return;
    this.#clearProjectSchedules(projectId);
    const rows = await this.db.all("publications");
    const scheduled = rows
      .map(row => row.value)
      .filter(record => record?.scheduledAt && record?.source?.kind === "project" && String(record.source.projectId) === String(projectId));
    if (!scheduled.length) return;
    await Promise.all(scheduled.map(record => this.db.delete("publications", record.id)));
    await this.#emitPublicationsChanged();
  }

  #armSchedule(projectId, postId, schedule, { runAt = Number(schedule?.scheduledAt || 0) } = {}) {
    const scheduledAt = Number(schedule?.scheduledAt || 0);
    if (!scheduledAt || !schedule?.chatId) return;
    const key = scheduleKey(projectId, postId);
    const current = this.scheduleTimers.get(key);
    if (current?.scheduledAt === scheduledAt) return;
    this.#clearScheduleByKey(key);
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY, Number(runAt || scheduledAt) - Date.now()));
    const timer = setTimeout(() => {
      this.scheduleTimers.delete(key);
      if (scheduledAt > Date.now()) {
        this.#armSchedule(projectId, postId, schedule);
        return;
      }
      this.#runScheduledPost(projectId, postId, schedule).catch(() => {});
    }, delay);
    this.scheduleTimers.set(key, { timer, scheduledAt, runAt: Number(runAt || scheduledAt) });
  }

  #clearSchedule(projectId, postId) { this.#clearScheduleByKey(scheduleKey(projectId, postId)); }

  #clearScheduleByKey(key) {
    const entry = this.scheduleTimers.get(key);
    if (entry) clearTimeout(entry.timer);
    this.scheduleTimers.delete(key);
  }

  async #runScheduledPost(projectId, postId, expectedSchedule) {
    const project = await this.store.getProject(projectId);
    const post = project?.posts?.find(item => String(item.id) === String(postId));
    const schedule = post?.publication?.state === "scheduled" ? post.schedule : null;
    if (!schedule || Number(schedule.scheduledAt) !== Number(expectedSchedule?.scheduledAt)) return;
    if (Number(schedule.scheduledAt) > Date.now()) {
      this.#armSchedule(projectId, postId, schedule);
      return;
    }
    try {
      await this.publishPost(projectId, postId, schedule.chatId, { commentsEnabled: schedule.commentsEnabled !== false });
    } catch (error) {
      this.#emit("schedule-error", project, {
        postId: post.id,
        postIds: [post.id],
        scheduledAt: Number(schedule.scheduledAt),
        error,
        message: error?.message || String(error)
      });
      this.#armSchedule(projectId, postId, schedule, { runAt: Date.now() + SCHEDULE_RETRY_DELAY });
    }
  }

  #emit(state, project, extra = {}) {
    this.events?.emit("project:publication", {
      state,
      projectId: project?.id || null,
      project: project ? structuredClone(project) : null,
      ...extra
    });
  }
}

export function projectPublicationId(projectId, postId) {
  return `project_publication_${String(projectId)}_${String(postId)}`;
}

function scheduleKey(projectId, postId) {
  return `${String(projectId)}:${String(postId)}`;
}

function publicationOrder(project) {
  if (isLinearProject(project)) return (project.posts || []).map(post => post.id);
  const index = new ProjectIndex(project);
  const mapHosts = new Set(index.mapToHostPost.values());
  return [
    ...(project.posts || []).filter(post => mapHosts.has(post.id)).map(post => post.id),
    ...(project.posts || []).filter(post => !mapHosts.has(post.id)).map(post => post.id)
  ];
}
