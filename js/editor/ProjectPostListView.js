import { t } from "../i18n/index.js?v=1.8.0";
import { createProjectPostCard } from "../project/ProjectPostCard.js?v=1.7.12";
import { ProjectIndex } from "../project/ProjectIndex.js?v=1.5.9";
import { getProjectPostPublicationEligibility } from "../project/ProjectPublicationEligibility.js?v=1.5.9";
import { linkTargetTooltip, linkTargetVisualState } from "../links/LinkTarget.js?v=1.5.9";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";

export function createProjectPostListView({
  project,
  activePostId = null,
  onClose = null,
  onSelect = null,
  onSelectTarget = null,
  onOpenLinkedSource = null,
  linkTargetSlotKey = "",
  linkedTargets = {},
  onRename = null,
  onPublish = null,
  onSchedule = null,
  onCancelSchedule = null,
  onApplyChanges = null,
  onDelete = null
} = {}) {
  const fragment = document.createDocumentFragment();
  const head = el("div", "project-panel-head");
  const titleWrap = el("div", "project-panel-heading");
  const posts = project?.posts || [];
  titleWrap.append(el("strong", "", project?.title || t("project.projectLibraryView.project")), el("span", "", t("editor.projectPostListView.post", { 0: posts.length, 1: plural(posts.length) })));
  const close = button("×", t("editor.projectPostListView.closeProject"), () => onClose?.());
  close.className = "project-panel-close";
  head.append(titleWrap, close);

  const list = el("div", "project-post-list");
  const index = new ProjectIndex(project);
  posts.forEach(post => {
    const eligibility = getProjectPostPublicationEligibility(project, post.id, index);
    const target = linkTargetForProjectPost(project, post);
    let card = null;
    const cardActions = [
      createLinkTargetButton(target, { linkTargetSlotKey, linkedTargets, onSelectTarget, onOpenLinkedSource }),
      button("✎", t("editor.projectPostListView.rename"), () => showRenameEditor(card, post, onRename))
    ];
    const remove = button("🗑", t("editor.projectPostListView.deletePost"), () => showCardDeleteConfirmation(card, {
      message: t("editor.projectPostListView.deleteFromProject", { 0: post.title || t("editor.blockInspector.post") }),
      onConfirm: () => onDelete?.(post)
    }));
    remove.classList.add("danger-soft");
    const isRoot = String(post.id) === String(project?.structure?.rootPostId || "");
    const isPublished = post?.publication?.state === "published" || Boolean(post?.deployments?.production?.messageId);
    remove.disabled = isRoot || isPublished || !onDelete;
    remove.title = isRoot
      ? t("editor.projectPostListView.theStartingPostContainsAMapAnd")
      : isPublished
        ? t("editor.projectPostListView.firstDeleteThePostPublication")
        : t("editor.projectPostListView.deletePostFromProject");
    cardActions.push(remove);
    card = createProjectPostCard({
      post,
      variant: "compact",
      selected: post.id === activePostId,
      active: post.id === activePostId,
      project,
      projectIndex: index,
      showPublicationActions: eligibility.eligible,
      onPublish: onPublish ? targetPost => onPublish(targetPost) : null,
      onSchedule: onSchedule ? targetPost => onSchedule(targetPost) : null,
      onCancelSchedule: onCancelSchedule ? targetPost => onCancelSchedule(targetPost) : null,
      onApplyChanges: onApplyChanges ? targetPost => onApplyChanges(targetPost) : null,
      onSelect: selectedPost => onSelect?.(selectedPost),
      actions: cardActions
    });
    list.append(card);
  });

  fragment.append(head, list);
  return fragment;
}

function linkTargetForProjectPost(project, post) {
  return {
    kind: "project_post",
    id: `${project.id}:${post.id}`,
    projectId: project.id,
    postId: post.id,
    title: post.title || t("editor.projectPostListView.projectPost")
  };
}

function createLinkTargetButton(target, { linkTargetSlotKey, linkedTargets, onSelectTarget, onOpenLinkedSource }) {
  const state = linkTargetVisualState(target, { targetKey: linkTargetSlotKey, linkedTargets });
  const action = state === "linked" ? onOpenLinkedSource : onSelectTarget;
  const tooltip = linkTargetTooltip(target, state, linkedTargets);
  const item = button("↙", tooltip, () => action?.(target));
  item.classList.add("link-target-button", `is-${state}`);
  item.dataset.linkTargetState = state;
  item.setAttribute("aria-pressed", String(state === "selected"));
  return item;
}

function showRenameEditor(card, post, onRename) {
  if (!card || card.querySelector?.(":scope > .project-post-card-overlay")) return;
  card.parentElement?.querySelector?.(".project-post-card-overlay")?.remove?.();

  const overlay = el("div", "project-post-card-overlay project-post-rename-editor");
  const input = document.createElement("input");
  input.className = "project-post-rename-input";
  input.type = "text";
  input.value = String(post?.title || "");
  input.placeholder = t("editor.projectPostListView.postTitle");
  input.setAttribute("aria-label", t("editor.projectPostListView.postTitle"));
  const actions = el("div", "project-post-card-overlay-actions");
  const cancel = button(t("core.cardDeleteConfirmation.cancel"), t("editor.draftListView.cancelRenaming"), () => overlay.remove());
  const save = button(t("core.darkDialog.save"), t("editor.projectPostListView.savePostTitle"), async () => {
    const title = input.value.trim();
    if (!title) {
      input.classList.add("invalid");
      input.focus();
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    const result = await onRename?.(post, title);
    if (result == null && overlay.isConnected) {
      save.disabled = false;
      cancel.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
  save.classList.add("primary");
  input.oninput = () => input.classList.remove("invalid");
  input.onkeydown = event => {
    if (event.key === "Escape") {
      event.preventDefault();
      overlay.remove();
    } else if (event.key === "Enter") {
      event.preventDefault();
      save.click();
    }
  };
  actions.append(cancel, save);
  overlay.append(input, actions);
  overlay.onclick = event => event.stopPropagation();
  card.append(overlay);
  input.focus();
  input.select();
}

function plural(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return t("editor.projectPostListView.ov");
  if (n1 > 1 && n1 < 5) return t("editor.projectPostListView.a");
  if (n1 === 1) return "";
  return t("editor.projectPostListView.ov");
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
