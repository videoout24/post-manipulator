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
  if (kind === "publication") return "Публикация";
  if (kind === "project_post") return "Пост проекта";
  if (kind === "draft") return "Черновик";
  if (kind === "external") return "Внешняя ссылка";
  return "Сообщение";
}

export function linkTargetVisualState(target, { targetKey = "", linkedTargets = {} } = {}) {
  const key = linkTargetKey(target);
  if (key && key === targetKey) return "selected";
  return linkedTargets?.[key] ? "linked" : "idle";
}

export function linkTargetTooltip(target, state, linkedTargets = {}) {
  const title = normalizeLinkTarget(target)?.title || "Сообщение";
  if (state === "selected") return `Выбрано для связи: ${title}. Нажмите ещё раз, чтобы отменить.`;
  if (state === "linked") {
    const count = Number(linkedTargets?.[linkTargetKey(target)]?.count || 1);
    return count > 1
      ? `Связано с ${count} фрагментами: ${title}. Нажмите, чтобы открыть источник последней связи в Editor.`
      : `Связано с: ${title}. Нажмите, чтобы открыть источник связи в Editor.`;
  }
  return `Выбрать как цель ссылки: ${title}`;
}
