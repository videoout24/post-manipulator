import { createProjectPostCard } from "./ProjectPostCard.js?v=1.7.12";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";
import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { getProjectPostPublicationEligibility } from "./ProjectPublicationEligibility.js?v=1.5.9";
import { linkTargetTooltip, linkTargetVisualState } from "../links/LinkTarget.js?v=1.5.9";

export class ProjectLibraryView {
  constructor({
    root, store, session, draftSession = null, graphReconciler = null, events,
    gallery = null, thumbnails = null,
    onOpenEditor = null, onPublishProject = null, onPublishPost = null,
    onSchedulePost = null, onCancelPostSchedule = null, onError = null
  } = {}) {
    this.root = root;
    this.store = store;
    this.session = session;
    this.draftSession = draftSession;
    this.graphReconciler = graphReconciler;
    this.events = events;
    this.gallery = gallery;
    this.thumbnails = thumbnails;
    this.onOpenEditor = onOpenEditor;
    this.onPublishProject = onPublishProject;
    this.onPublishPost = onPublishPost;
    this.onSchedulePost = onSchedulePost;
    this.onCancelPostSchedule = onCancelPostSchedule;
    this.onError = onError;
    this.unsubscribers = [];
    this.selectedProjectId = null;
    this.selectedPosts = new Map();
    this.linkTargetSlotKey = "";
    this.linkedTargets = {};
  }

  async initialize() {
    this.unsubscribers.push(
      this.events?.on?.("project:changed", event => {
        if (event?.reason === "deleted" && event.projectId === this.selectedProjectId) this.selectedProjectId = null;
        this.render();
      }),
      this.events?.on?.("project:session-changed", ({ activeProjectId, activePostId } = {}) => {
        if (activeProjectId && activePostId) this.selectedPosts.set(activeProjectId, activePostId);
        this.render();
      }),
      this.events?.on?.("project:preview-sync", () => this.render()),
      this.events?.on?.("gallery:ingested", () => this.render()),
      this.events?.on?.("gallery:asset-added", () => this.render()),
      this.events?.on?.("gallery:asset-updated", () => this.render()),
      this.events?.on?.("gallery:asset-removed", () => this.render()),
      this.events?.on?.("links:target-slot-changed", ({ targetKey = "" } = {}) => {
        if (targetKey === this.linkTargetSlotKey) return;
        this.linkTargetSlotKey = targetKey;
        this.render();
      }),
      this.events?.on?.("links:relation-targets-changed", ({ linkedTargets = {} } = {}) => {
        this.linkedTargets = linkedTargets;
        this.render();
      })
    );
    this.events?.emit?.("links:state-requested");
    await this.render();
  }

  stop() { for (const off of this.unsubscribers.splice(0)) off?.(); }

  async render() {
    if (!this.root) return;
    try {
      const projects = await this.store.listProjects();
      const activeId = this.session.activeProjectId;
      this.#normalizeSelection(projects, activeId);
      const selected = projects.find(project => project.id === this.selectedProjectId) || null;
      const selectedPostId = selected ? this.#ensureSelectedPost(selected) : null;
      this.#renderSidebar(projects, activeId);
      this.#renderDetail(selected, activeId, selectedPostId);
      this.#renderPostPanel(selected, activeId, selectedPostId);
    } catch (error) {
      this.onError?.(error);
    }
  }

  #normalizeSelection(projects, activeId) {
    if (this.selectedProjectId && projects.some(project => project.id === this.selectedProjectId)) return;
    this.selectedProjectId = projects.find(project => project.id === activeId)?.id || projects[0]?.id || null;
  }

  #renderSidebar(projects, activeId) {
    const root = this.root.querySelector("#projectLibrarySidebar");
    if (!root) return;
    root.innerHTML = "";

    const head = el("div", "project-library-sidebar-head");
    const title = el("div", "project-library-sidebar-title");
    title.append(el("strong", "", "Проекты"), el("span", "", `${projects.length} в библиотеке`));
    head.append(title, button("+ Создать", () => this.#createProject(), "primary"));

    const list = el("div", "project-library-list");
    if (!projects.length) {
      const empty = el("div", "project-library-empty compact");
      empty.append(el("strong", "", "Проектов пока нет"), el("span", "", "Создайте первый проект."));
      list.append(empty);
    }

    for (const project of projects) {
      const selected = project.id === this.selectedProjectId;
      const item = el("article", `project-library-item${selected ? " selected" : ""}${project.id === activeId ? " active-editor" : ""}`);
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-pressed", String(selected));
      item.dataset.projectId = project.id;
      const selectProject = () => {
        this.selectedProjectId = project.id;
        this.#ensureSelectedPost(project);
        this.render();
      };
      item.onclick = event => {
        if (event.target.closest("button, input, textarea, select")) return;
        selectProject();
      };
      item.onkeydown = event => {
        if (!["Enter", " "].includes(event.key) || event.target.closest("button, input, textarea, select")) return;
        event.preventDefault();
        selectProject();
      };
      const line = el("div", "project-library-item-line");
      const identity = el("div", "project-library-item-identity");
      identity.append(el("strong", "", project.title), el("span", "project-library-count", `${project.posts.length}`));
      const tools = el("div", "project-library-item-tools");
      const rename = button("✎", () => showProjectRenameOverlay(item, project, (source, title) => this.#renameProject(source, title)));
      rename.title = "Переименовать проект";
      const hasPublished = hasPublishedPosts(project);
      const remove = button("🗑", () => showCardDeleteConfirmation(item, {
        message: `Удалить проект «${project?.title || "Проект"}» и все его посты?`,
        onConfirm: () => this.#deleteProject(project)
      }), "danger-soft");
      remove.disabled = hasPublished;
      remove.title = hasPublished
        ? "Сначала удалите все опубликованные посты из Публикаций"
        : "Удалить проект";
      tools.append(rename, remove);
      line.append(identity, tools);
      const meta = el("div", "project-library-item-meta");
      meta.append(el("span", "", formatDate(project.updatedAt)));
      if (hasPreviewDeployment(project)) meta.append(el("span", "project-preview-badge", "Preview"));
      if (project.id === activeId) meta.append(el("span", "project-active-badge", "Editor"));
      item.append(line, meta);
      if (this.onPublishProject && hasUnpublishedPosts(project)) {
        const publication = el("div", "project-library-item-publication");
        const publish = button("Опубликовать проект", () => this.#publishProject(project), "primary");
        publish.title = "Опубликовать все ещё не опубликованные посты Project";
        publication.append(publish);
        item.append(publication);
      }
      list.append(item);
    }

    root.append(head, list);
  }

  #renderDetail(project, activeId, selectedPostId = null) {
    const root = this.root.querySelector("#projectLibraryDetail");
    if (!root) return;
    root.innerHTML = "";
    if (!project) {
      const empty = el("div", "project-library-detail-empty");
      empty.append(el("strong", "", "Выберите проект"), el("span", "", "В центральной области появится обзор его постов."));
      root.append(empty);
      return;
    }

    selectedPostId ||= this.#ensureSelectedPost(project);
    const head = el("div", "project-library-detail-head");
    const heading = el("div", "project-library-detail-heading");
    const titleLine = el("div", "project-library-detail-title-line");
    titleLine.append(el("h1", "", project.title));
    if (hasPreviewDeployment(project)) titleLine.append(el("span", "project-preview-badge", "Preview channel"));
    if (project.id === activeId) titleLine.append(el("span", "project-active-badge", "Открыт в Editor"));
    heading.append(titleLine, el("p", "", "Read-only обзор постов. Иконка карандаша открывает выбранный пост в Editor."));
    head.append(heading);

    const meta = el("div", "project-library-detail-meta");
    meta.append(
      el("span", "", `${project.posts.length} пост${plural(project.posts.length)}`),
      el("span", "", `Изменён: ${formatDate(project.updatedAt)}`)
    );

    const cards = el("div", "project-library-posts");
    const projectIndex = new ProjectIndex(project);
    if (!project.posts.length) {
      cards.append(el("div", "project-library-detail-empty", "В проекте нет постов"));
    }
    for (const post of project.posts) {
      const eligibility = getProjectPostPublicationEligibility(project, post.id, projectIndex);
      let card = null;
      const deleteButton = this.#postDeleteButton(project, post, () => showCardDeleteConfirmation(card, {
        message: `Удалить «${post.title || "Пост"}» из проекта?`,
        onConfirm: () => this.#deletePost(project, post)
      }));
      card = createProjectPostCard({
        post,
        variant: "overview",
        selected: post.id === selectedPostId,
        active: project.id === activeId && post.id === this.session.activePostId,
        showPublicationActions: eligibility.eligible,
        onPublish: this.onPublishPost ? targetPost => this.#publishPost(project, targetPost) : null,
        onSchedule: this.onSchedulePost ? targetPost => this.#schedulePost(project, targetPost) : null,
        onCancelSchedule: this.onCancelPostSchedule ? targetPost => this.#cancelPostSchedule(project, targetPost) : null,
        gallery: this.gallery,
        thumbnails: this.thumbnails,
        project,
        projectIndex,
        actions: [
          projectPostOpenButton(() => this.#openProject(project, post)),
          projectPostLinkButton(project, post, {
            targetKey: this.linkTargetSlotKey,
            linkedTargets: this.linkedTargets,
            onSelect: target => this.#selectLinkTarget(target),
            onOpenLinkedSource: target => this.#openLinkedSource(target)
          }),
          deleteButton
        ],
        onNavigatePost: targetPostId => this.#navigateToProjectPost(project, activeId, targetPostId),
        onNavigateMap: targetMapId => {
          const hostPostId = projectIndex.hostPostForMap(targetMapId);
          if (hostPostId) this.#navigateToProjectPost(project, activeId, hostPostId, { mapId: targetMapId });
        },
        onSelect: selectedPost => {
          this.selectedPosts.set(project.id, selectedPost.id);
          this.#renderDetail(project, activeId, selectedPost.id);
          this.#renderPostPanel(project, activeId, selectedPost.id);
        }
      });
      cards.append(card);
    }

    root.append(head, meta, cards);
  }

  #renderPostPanel(project, activeId, selectedPostId = null) {
    const root = this.root.querySelector("#projectLibraryPostPanel");
    if (!root) return;
    root.innerHTML = "";
    root.classList.toggle("visible", Boolean(project && selectedPostId));

    if (!project) {
      root.append(createPanelEmpty("Выберите проект", "Здесь появятся данные выбранного поста."));
      return;
    }

    const post = project.posts.find(item => item.id === selectedPostId) || null;
    if (!post) {
      root.append(createPanelEmpty("Выберите пост", "Выберите карточку поста в обзоре проекта."));
      return;
    }

    const postNumber = project.posts.findIndex(item => item.id === post.id) + 1;
    const stats = collectPostStats(post.messageAst);
    const projectIndex = new ProjectIndex(project);
    const head = el("div", "post-detail-panel-head");
    const heading = el("div", "post-detail-panel-heading");
    heading.append(
      el("span", "post-detail-panel-kicker", "Пост проекта"),
      el("h2", "", post.title || "Пост"),
      el("span", `post-detail-panel-state ${post?.publication?.state || "draft"}`, postStateLabel(post))
    );
    const close = button("×", () => this.#clearSelectedPost(project, activeId), "post-detail-panel-close");
    close.title = "Закрыть панель выбранного поста";
    close.setAttribute("aria-label", close.title);
    head.append(heading, close);

    const actions = el("div", "post-detail-panel-actions");
    const open = button("Открыть в Editor", () => this.#openProject(project, post), "primary");
    open.title = "Открыть выбранный пост в Editor";
    actions.append(open);
    const remove = this.#postDeleteButton(project, post, () => showCardDeleteConfirmation(root, {
      message: `Удалить «${post.title || "Пост"}» из проекта?`,
      onConfirm: () => this.#deletePost(project, post)
    }), { label: "Удалить пост" });
    actions.append(remove);

    const data = el("dl", "post-detail-panel-data");
    appendPostData(data, "Проект", project.title);
    appendPostData(data, "Позиция", `${postNumber} из ${project.posts.length}`);
    appendPostData(data, "Статус", postStateLabel(post));
    appendPostData(data, "Блоки", String(stats.blocks));
    appendPostData(data, "Медиа", stats.media ? String(stats.media) : "Нет");
    appendPostData(data, "Создан", formatDate(post.createdAt));
    appendPostData(data, "Изменён", formatDate(post.updatedAt));
    if (post.deployments?.preview?.messageId) appendPostData(data, "Preview", "Выгружен");
    if (project.id === activeId && post.id === this.session.activePostId) appendPostData(data, "Editor", "Сейчас открыт");

    const content = el("section", "post-detail-panel-content");
    content.append(el("h3", "", "Содержимое"));
    content.append(createProjectPostCard({
      post,
      variant: "overview",
      gallery: this.gallery,
      thumbnails: this.thumbnails,
      project,
      projectIndex,
      onNavigatePost: targetPostId => this.#navigateToProjectPost(project, activeId, targetPostId),
      onNavigateMap: targetMapId => {
        const hostPostId = projectIndex.hostPostForMap(targetMapId);
        if (hostPostId) this.#navigateToProjectPost(project, activeId, hostPostId, { mapId: targetMapId });
      }
    }));

    root.append(head, actions, data, content);
  }

  #clearSelectedPost(project, activeId) {
    this.selectedPosts.set(project.id, null);
    this.#renderDetail(project, activeId, null);
    this.#renderPostPanel(project, activeId, null);
  }

  #navigateToProjectPost(project, activeId, postId, { mapId = null } = {}) {
    if (!project?.posts?.some(post => post.id === postId)) return;
    this.selectedPosts.set(project.id, postId);
    this.#renderDetail(project, activeId, postId);
    this.#renderPostPanel(project, activeId, postId);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const detail = this.root?.querySelector?.("#projectLibraryDetail");
      if (!detail) return;
      const card = [...detail.querySelectorAll(".project-post-card")].find(item => item.dataset.postId === postId);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(card);
      if (!mapId) return;
      const map = [...card.querySelectorAll(".project-post-preview-map")].find(item => item.dataset.mapId === mapId);
      if (map) flash(map);
    }));
  }

  #ensureSelectedPost(project) {
    if (this.selectedPosts.has(project.id) && this.selectedPosts.get(project.id) === null) return null;
    const remembered = this.selectedPosts.get(project.id);
    const valid = project.posts.some(post => post.id === remembered);
    const preferred = valid
      ? remembered
      : (this.session.activeProjectId === project.id && project.posts.some(post => post.id === this.session.activePostId)
          ? this.session.activePostId
          : project.posts[0]?.id || null);
    if (preferred) this.selectedPosts.set(project.id, preferred);
    else this.selectedPosts.delete(project.id);
    return preferred;
  }

  #selectLinkTarget(target) {
    this.events?.emit?.("links:target-selected", target);
  }

  #openLinkedSource(target) {
    this.events?.emit?.("links:open-linked-source-requested", target);
  }

  async #createProject() {
    const title = await requestNewProjectTitle();
    if (!title) return;
    await this.#run(async () => {
      const project = await this.store.createProject({ title });
      this.selectedProjectId = project.id;
      this.#ensureSelectedPost(project);
      await this.render();
    });
  }

  async #openProject(project, selectedPost = null) {
    await this.#run(async () => {
      await this.#activateProject(project.id, selectedPost?.id || null);
    });
  }

  async #publishProject(project) {
    return this.#run(() => this.onPublishProject?.(project));
  }

  async #publishPost(project, post) {
    return this.#run(() => this.onPublishPost?.(project, post));
  }

  async #schedulePost(project, post) {
    return this.#run(() => this.onSchedulePost?.(project, post));
  }

  async #cancelPostSchedule(project, post) {
    return this.#run(() => this.onCancelPostSchedule?.(project, post));
  }

  async #activateProject(projectId, postId = null) {
    // Draft and Project are separate editor contexts. Persist the active draft before
    // replacing the Canvas with a Project post, then relinquish the draft context.
    if (this.draftSession?.isActive?.()) {
      await this.draftSession.flush();
      await this.draftSession.deactivate({ flush: false, reason: "project-opened" });
    }
    await this.session.openProject(projectId, { postId });
    await this.session.flush();
    await this.graphReconciler?.reconcile?.(projectId);
    await this.session.refreshProject({ reloadActiveAst: true });
    this.onOpenEditor?.();
  }

  async #renameProject(project, title) {
    return this.#run(async () => {
      await this.store.renameProject(project.id, title);
      if (this.session.activeProjectId === project.id) await this.session.refreshProject();
      return true;
    });
  }

  async #deleteProject(project) {
    return this.#run(async () => {
      if (hasPublishedPosts(project)) {
        throw new Error("Сначала удалите все опубликованные посты из Публикаций");
      }
      if (this.session.activeProjectId === project.id) await this.session.closeProject();
      await this.store.deleteProject(project.id);
      this.selectedPosts.delete(project.id);
      if (this.selectedProjectId === project.id) this.selectedProjectId = null;
      return true;
    });
  }

  #postDeleteButton(project, post, handler, { label = "🗑" } = {}) {
    const remove = button(label, handler, "danger-soft");
    const isRoot = String(post?.id || "") === String(project?.structure?.rootPostId || "");
    const isPublished = post?.publication?.state === "published" || Boolean(post?.deployments?.production?.messageId);
    remove.disabled = isRoot || isPublished;
    remove.title = isRoot
      ? "Стартовый пост содержит карту и удаляется только вместе с проектом"
      : isPublished
        ? "Сначала удалите публикацию поста"
        : "Удалить пост из проекта";
    remove.setAttribute("aria-label", remove.title);
    return remove;
  }

  async #deletePost(project, post) {
    const result = await this.#run(async () => {
      const index = project.posts.findIndex(item => String(item.id) === String(post.id));
      const fallback = project.posts[index + 1] || project.posts[index - 1] || null;
      if (this.session.activeProjectId === project.id) await this.session.deletePost(post.id);
      else await this.store.deletePost(project.id, post.id);
      if (this.selectedPosts.get(project.id) === post.id) {
        this.selectedPosts.set(project.id, fallback?.id || null);
      }
      return true;
    });
    return result === true;
  }

  async #run(action) {
    try { return await action(); }
    catch (error) { this.onError?.(error); return null; }
  }
}

function requestNewProjectTitle() {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "project-create-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const head = el("div", "dialog-head");
    head.append(el("strong", "", "Новый проект"));
    head.append(button("×", () => dialog.close("cancel")));
    const body = el("div", "project-create-dialog-body");
    const field = el("label", "project-create-dialog-field");
    field.append(el("span", "", "Название проекта"));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 160;
    input.value = "Новый проект";
    input.setAttribute("aria-label", "Название проекта");
    field.append(input);
    const error = el("div", "project-create-dialog-error");
    const actions = el("div", "format-config-actions");
    const cancel = button("Отмена", () => dialog.close("cancel"));
    const create = button("Создать", () => {
      if (!input.value.trim()) {
        error.textContent = "Введите название проекта";
        input.classList.add("invalid");
        input.focus();
        return;
      }
      dialog.close("create");
    }, "primary");
    input.oninput = () => {
      input.classList.remove("invalid");
      error.textContent = "";
    };
    input.onkeydown = event => {
      if (event.key === "Enter") { event.preventDefault(); create.click(); }
    };
    actions.append(cancel, create);
    body.append(field, error, actions);
    form.append(head, body);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      const title = dialog.returnValue === "create" ? input.value.trim() : null;
      dialog.remove();
      resolve(title);
    }, { once: true });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

function projectPostOpenButton(handler) {
  const item = button("✎", handler, "project-post-open-editor");
  item.title = "Редактировать этот пост в Editor";
  item.setAttribute("aria-label", "Редактировать пост в Editor");
  return item;
}

function projectPostLinkButton(project, post, { targetKey, linkedTargets, onSelect, onOpenLinkedSource }) {
  const target = {
    kind: "project_post",
    id: `${project.id}:${post.id}`,
    projectId: project.id,
    postId: post.id,
    title: post.title || "Пост проекта"
  };
  const state = linkTargetVisualState(target, { targetKey, linkedTargets });
  const action = state === "linked" ? onOpenLinkedSource : onSelect;
  const item = button("↙", () => action?.(target), `project-post-link-target link-target-button is-${state}`);
  item.dataset.linkTargetState = state;
  item.title = linkTargetTooltip(target, state, linkedTargets);
  item.setAttribute("aria-label", item.title);
  item.setAttribute("aria-pressed", String(state === "selected"));
  return item;
}

function showProjectRenameOverlay(card, project, onRename) {
  if (!card || card.querySelector?.(":scope > .project-post-card-overlay")) return;
  card.parentElement?.querySelector?.(".project-post-card-overlay")?.remove?.();
  const overlay = el("div", "project-post-card-overlay project-post-rename-editor");
  const input = document.createElement("input");
  input.className = "project-post-rename-input";
  input.type = "text";
  input.value = project?.title || "";
  input.placeholder = "Название проекта";
  input.setAttribute("aria-label", "Название проекта");
  const actions = el("div", "project-post-card-overlay-actions");
  const cancel = button("Отмена", () => overlay.remove());
  const save = button("Сохранить", async () => {
    const title = input.value.trim();
    if (!title) {
      input.classList.add("invalid");
      input.focus();
      return;
    }
    save.disabled = cancel.disabled = input.disabled = true;
    const result = await onRename?.(project, title);
    if (result == null && overlay.isConnected) {
      save.disabled = cancel.disabled = input.disabled = false;
      input.focus();
    }
  }, "primary");
  input.oninput = () => input.classList.remove("invalid");
  input.onkeydown = event => {
    if (event.key === "Escape") overlay.remove();
    else if (event.key === "Enter") { event.preventDefault(); save.click(); }
  };
  actions.append(cancel, save);
  overlay.append(input, actions);
  overlay.onclick = event => event.stopPropagation();
  card.append(overlay);
  input.focus();
  input.select();
}

function formatDate(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function createPanelEmpty(title, message) {
  const empty = el("div", "post-detail-panel-empty");
  empty.append(el("strong", "", title), el("span", "", message));
  return empty;
}

function appendPostData(list, label, value) {
  list.append(el("dt", "", label), el("dd", "", value || "—"));
}

function collectPostStats(ast) {
  const stats = { blocks: 0, media: 0 };
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.type && node.type !== "document") {
      stats.blocks += 1;
      if (["photo", "video", "document"].includes(node.type)) stats.media += 1;
    }
    for (const child of node.children || []) visit(child);
  };
  visit(ast);
  return stats;
}

function postStateLabel(post) {
  const state = post?.publication?.state || "draft";
  if (state === "published") return "Опубликован";
  if (state === "scheduled") return post?.schedule ? `Запланирован · ${post.schedule}` : "Запланирован";
  return "Черновик";
}

function plural(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "ов";
  if (n1 > 1 && n1 < 5) return "а";
  if (n1 === 1) return "";
  return "ов";
}

function button(text, handler, className = "") {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  if (className) item.className = className;
  item.onclick = handler;
  return item;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function flash(node) {
  if (!node) return;
  node.classList.remove("nav-highlight");
  void node.offsetWidth;
  node.classList.add("nav-highlight");
  setTimeout(() => node?.classList?.remove?.("nav-highlight"), 1600);
}

function hasPreviewDeployment(project) {
  return (project?.posts || []).some(post => post.deployments?.preview?.messageId);
}

function hasUnpublishedPosts(project) {
  return (project?.posts || []).some(post =>
    post?.publication?.state !== "published" || !post?.deployments?.production?.messageId
  );
}

function hasPublishedPosts(project) {
  return (project?.posts || []).some(post =>
    post?.publication?.state === "published" || post?.deployments?.production?.messageId
  );
}
