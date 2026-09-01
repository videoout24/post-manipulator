import { getLocale, t } from "../i18n/index.js?v=1.8.0";
import { linkTargetTooltip, linkTargetVisualState } from "../links/LinkTarget.js?v=1.5.9";
import { showCardDeleteConfirmation } from "../core/CardDeleteConfirmation.js?v=1.5.9";

export function createDraftListView({
  drafts = [],
  activeDraftId = null,
  onClose = null,
  onOpen = null,
  onRename = null,
  onDelete = null,
  onMoveToProject = null,
  onPublish = null,
  onSchedule = null,
  onApplyChanges = null,
  onCancelPublicationEdit = null,
  onSelectTarget = null,
  onOpenLinkedSource = null,
  linkTargetSlotKey = "",
  linkedTargets = {}
} = {}) {
  const fragment = document.createDocumentFragment();
  const head = el("div", "project-panel-head draft-panel-head");
  const titleWrap = el("div", "project-panel-heading");
  const publicationContext = drafts.length === 1
    && drafts[0].id === activeDraftId
    && drafts[0].source?.kind === "publication";
  titleWrap.append(
    el("strong", "", publicationContext ? t("editor.draftListView.editPublication") : t("editor.draftListView.drafts")),
    el("span", "", publicationContext ? (drafts[0].source?.targetTitle || "Telegram") : t("editor.draftListView.saved", { 0: drafts.length }))
  );
  const close = button(
    "×",
    publicationContext ? t("editor.draftListView.cancelEditingThePublication") : t("editor.draftListView.closeDrafts"),
    () => publicationContext ? onCancelPublicationEdit?.(drafts[0]) : onClose?.()
  );
  close.className = "project-panel-close";
  head.append(titleWrap, close);

  const list = el("div", "project-post-list draft-list");
  if (!drafts.length) {
    const empty = el("div", "draft-panel-empty");
    empty.append(el("strong", "", t("editor.draftListView.noDraftsYet")), el("span", "", t("editor.draftListView.theNewButtonCreatesANamedDraft")));
    list.append(empty);
  } else {
    for (const draft of drafts) {
      list.append(createDraftCard({
        draft,
        selected: activeDraftId === draft.id,
        onOpen,
        onRename,
        onDelete,
        onMoveToProject,
        onPublish,
        onSchedule,
        onApplyChanges,
        onCancelPublicationEdit,
        onSelectTarget,
        onOpenLinkedSource,
        linkTargetSlotKey,
        linkedTargets
      }));
    }
  }

  fragment.append(head, list);
  return fragment;
}

function createDraftCard({
  draft, selected, onOpen, onRename, onDelete, onMoveToProject, onPublish,
  onSchedule, onApplyChanges, onCancelPublicationEdit, onSelectTarget, onOpenLinkedSource, linkTargetSlotKey, linkedTargets
}) {
  const publicationCopy = draft.source?.kind === "publication" && draft.source?.publicationId;
  const card = el("article", `draft-card${selected ? " selected" : ""}${publicationCopy ? " draft-publication-edit" : ""}`);
  card.dataset.draftId = draft.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-pressed", String(selected));

  const head = el("div", "draft-card-head");
  const body = el("div", "draft-card-body");
  body.append(el("strong", "", draft.title || t("editor.draftListView.draft")));
  body.append(el("span", "draft-card-meta", `${sourceLabel(draft.source)} · ${formatTime(draft.updatedAt)}`));
  head.append(body);
  const tools = el("div", "draft-card-tools");
  const target = linkTargetForDraft(draft);
  tools.append(createLinkTargetButton(target, { linkTargetSlotKey, linkedTargets, onSelectTarget, onOpenLinkedSource }));
  if (!publicationCopy) {
    tools.append(
      button("✎", t("editor.draftListView.renameDraft"), () => showRenameEditor(card, draft, onRename)),
      button("🗑", t("editor.draftListView.deleteDraft"), () => showCardDeleteConfirmation(card, { message: t("editor.blockPalette.delete", { 0: draft?.title || t("editor.draftListView.draft") }), onConfirm: () => onDelete?.(draft) }))
    );
    tools.lastElementChild?.classList.add("danger-soft");
  }
  head.append(tools);
  card.append(head);

  const actions = el("div", "draft-card-actions draft-card-lifecycle-actions");
  if (publicationCopy) {
    actions.classList.add("publication-edit-actions");
    const scheduledCopy = Boolean(draft.source?.scheduledAt);
    const apply = button(
      t("editor.draftListView.applyChanges"),
      scheduledCopy ? t("editor.draftListView.updateTheContentOfTheScheduledPublication") : t("editor.draftListView.updatePublishedMessage"),
      () => onApplyChanges?.(draft)
    );
    apply.classList.add("publication-edit-apply");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"), t("editor.draftListView.cancelEditingAndDeleteWorkingCopy"), () => onCancelPublicationEdit?.(draft));
    cancel.classList.add("publication-edit-cancel");
    actions.append(apply, cancel);
  } else if (draftHasBlocks(draft)) {
    actions.append(button(t("editor.draftListView.toProject"), t("editor.draftListView.moveDraftToProject"), () => onMoveToProject?.(draft)));
    actions.append(button(t("editor.draftListView.publish"), t("editor.draftListView.publishDraft"), () => onPublish?.(draft)));
    actions.append(button(t("editor.draftListView.postpone"), t("editor.draftListView.scheduleDraftPublication"), () => onSchedule?.(draft)));
  }
  if (actions.childElementCount) card.append(actions);
  else card.classList.add("no-footer-actions");

  const open = () => onOpen?.(draft);
  card.onclick = event => {
    if (event.target.closest("button, a, input, textarea, select")) return;
    open();
  };
  card.onkeydown = event => {
    if (!["Enter", " "].includes(event.key) || event.target.closest("button, a, input, textarea, select")) return;
    event.preventDefault();
    open();
  };
  return card;
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

function linkTargetForDraft(draft) {
  if (draft?.source?.kind === "publication" && draft.source.publicationId) {
    return {
      kind: "publication",
      id: draft.source.publicationId,
      title: draft.title || draft.source.targetTitle || t("editor.draftListView.publication")
    };
  }
  return {
    kind: "draft",
    id: draft.id,
    title: draft.title || t("editor.draftListView.draft")
  };
}

export function draftHasBlocks(draft) {
  return Array.isArray(draft?.messageAst?.children) && draft.messageAst.children.length > 0;
}

function showRenameEditor(card, draft, onRename) {
  if (!card || card.querySelector?.(":scope > .project-post-card-overlay")) return;
  card.parentElement?.querySelector?.(".project-post-card-overlay")?.remove?.();
  const overlay = el("div", "project-post-card-overlay project-post-rename-editor");
  const input = document.createElement("input");
  input.className = "project-post-rename-input";
  input.type = "text";
  input.maxLength = 160;
  input.value = String(draft?.title || t("editor.draftListView.draft"));
  input.placeholder = t("editor.draftListView.draftTitle");
  input.setAttribute("aria-label", t("editor.draftListView.draftTitle"));
  const actions = el("div", "project-post-card-overlay-actions");
  const cancel = button(t("core.cardDeleteConfirmation.cancel"), t("editor.draftListView.cancelRenaming"), () => overlay.remove());
  const save = button(t("core.darkDialog.save"), t("editor.draftListView.saveDraftTitle"), async () => {
    const title = input.value.trim();
    if (!title) {
      input.classList.add("invalid");
      input.focus();
      return;
    }
    save.disabled = cancel.disabled = input.disabled = true;
    const result = await onRename?.(draft, title);
    if (result == null && overlay.isConnected) {
      save.disabled = cancel.disabled = input.disabled = false;
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

function sourceLabel(source) {
  if (source?.kind === "project") return source.postTitle
    ? t("editor.draftListView.projectPostTitle", { 0: source.postTitle })
    : t("editor.draftListView.projectPost");
  if (source?.kind === "publication") return source.targetTitle ? t("editor.draftListView.publication2", { 0: source.targetTitle }) : t("editor.draftListView.publication");
  return "Draft";
}

function formatTime(value) {
  const date = new Date(Number(value || Date.now()));
  try { return date.toLocaleString(getLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return date.toISOString(); }
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
