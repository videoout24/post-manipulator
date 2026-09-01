import { createProjectPostCard } from "./ProjectPostCard.js?v=1.7.12";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";
import { requestTextDialog } from "../core/DarkDialog.js?v=1.6.5";

export class ProjectPostPanel {
  constructor({ root, layout, session, events, onError = null } = {}) {
    this.root = root;
    this.layout = layout;
    this.session = session;
    this.events = events;
    this.onError = onError;
    this.unsubscribers = [];
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("project:session-changed", () => this.render()),
      this.events?.on?.("project:changed", event => {
        if (event?.projectId === this.session.activeProjectId) this.render();
      })
    );
    this.render();
  }

  stop() { for (const off of this.unsubscribers.splice(0)) off?.(); }

  render() {
    if (!this.root || !this.layout) return;
    const state = this.session.snapshot();
    const active = Boolean(state.activeProjectId && state.project);
    this.root.hidden = !active;
    this.layout.classList.toggle("project-active", active);
    const splitter = this.layout.querySelector("#editorProjectSplitter");
    if (splitter) splitter.hidden = !active;
    if (!active) {
      this.root.innerHTML = "";
      return;
    }

    const project = state.project;
    this.root.innerHTML = "";

    const head = el("div", "project-panel-head");
    const titleWrap = el("div", "project-panel-heading");
    titleWrap.append(el("strong", "", project.title), el("span", "", `${project.posts.length} пост${plural(project.posts.length)}`));
    const close = button("×", "Закрыть проект", () => this.#run(() => this.session.closeProject()));
    close.className = "project-panel-close";
    head.append(titleWrap, close);

    const actions = el("div", "project-panel-actions");
    actions.append(button("+ Пост", "Создать пост", () => this.#createPost()));

    const list = el("div", "project-post-list");
    for (const post of project.posts) {
      let card = null;
      card = createProjectPostCard({
        post,
        variant: "compact",
        selected: post.id === state.activePostId,
        active: post.id === state.activePostId,
        onSelect: selectedPost => {
          this.#run(() => this.session.openPost(selectedPost.id));
        },
        actions: [
          button("✎", "Переименовать", () => this.#renamePost(post)),
          button("🗑", "Удалить", () => showCardDeleteConfirmation(card, {
            message: `Удалить «${post.title}»?`,
            onConfirm: () => this.#deletePost(post)
          }))
        ]
      });
      list.append(card);
    }

    this.root.append(head, actions, list);
  }

  async #createPost() {
    const title = await requestTextDialog({
      title: "Новый пост",
      label: "Название поста",
      value: `Пост ${(this.session.project?.posts?.length || 0) + 1}`,
      submitLabel: "Создать"
    });
    if (title === null) return;
    await this.#run(() => this.session.createPost(title));
  }

  async #renamePost(post) {
    const title = await requestTextDialog({
      title: "Переименовать пост",
      label: "Название поста",
      value: post.title,
      submitLabel: "Сохранить"
    });
    if (title === null) return;
    await this.#run(() => this.session.renamePost(post.id, title));
  }

  async #deletePost(post) {
    return (await this.#run(() => this.session.deletePost(post.id))) ?? false;
  }

  async #run(action) {
    try { await action(); }
    catch (error) { this.onError?.(error); }
  }
}

function plural(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "ов";
  if (n1 > 1 && n1 < 5) return "а";
  if (n1 === 1) return "";
  return "ов";
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
