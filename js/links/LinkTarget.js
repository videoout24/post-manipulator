import { t } from "../i18n/index.js?v=1.8.0";
// A link target can come from several screens, but it has one stable identity
// everywhere in the editor.  Keeping this outside the views prevents a draft
// and a publication with a coincidentally similar title from sharing a slot.
export function normalizeLinkTarget(value = {}) {
  const kind = String(value?.kind || "").trim();
  const id = value?.id == null ? "" : String(value.id);
  if (!kind || !id) return null;
  return {
    ...structuredClone(value),
    kind,
    id,
    title: String(value.title || defaultTargetTitle(kind)).trim() || defaultTargetTitle(kind)
  };
}

export function linkTargetKey(value) {
  const target = normalizeLinkTarget(value);
  return target ? `${target.kind}:${target.id}` : "";
}

export function sameLinkTarget(left, right) {
  const a = linkTargetKey(left);
  const b = linkTargetKey(right);
  return Boolean(a && b && a === b);
}

export function internalLinkUrl(relationId) {
  return relationId ? `rmb-link:${String(relationId)}` : "";
}

export function isInternalLinkUrl(value) {
  return /^rmb-link:/i.test(String(value || ""));
}

export function defaultTargetTitle(kind) {
  if (kind === "publication") return t("editor.draftListView.publication");
  if (kind === "project_post") return t("editor.projectPostListView.projectPost");
  if (kind === "draft") return t("editor.draftListView.draft");
  if (kind === "external") return t("links.linkTarget.externalLink");
  return t("core.darkDialog.message");
}

export function linkTargetVisualState(target, { targetKey = "", linkedTargets = {} } = {}) {
  const key = linkTargetKey(target);
  if (key && key === targetKey) return "selected";
  return linkedTargets?.[key] ? "linked" : "idle";
}

export function linkTargetTooltip(target, state, linkedTargets = {}) {
  const title = normalizeLinkTarget(target)?.title || t("core.darkDialog.message");
  if (state === "selected") return t("links.linkTarget.selectedForConnectionClickAgainToCancel", { 0: title });
  if (state === "linked") {
    const count = Number(linkedTargets?.[linkTargetKey(target)]?.count || 1);
    return count > 1
      ? t("links.linkTarget.connectedWithFragmentsClickToOpenThe", { 0: count, 1: title })
      : t("links.linkTarget.connectedWithClickToOpenTheSource", { 0: title });
  }
  return t("links.linkTarget.selectAsLinkTarget", { 0: title });
}
