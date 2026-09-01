import { t } from "../i18n/index.js?v=1.8.0";
/** Renders one consistent, in-card confirmation before a destructive action. */
export function showCardDeleteConfirmation(card, { message, onConfirm, onCancel = null, confirmLabel = t("core.cardDeleteConfirmation.delete") } = {}) {
  if (!card) return null;
  document.querySelectorAll(".card-delete-confirmation").forEach(item => item.remove());

  const overlay = document.createElement("div");
  overlay.className = "project-post-card-overlay project-post-delete-confirm card-delete-confirmation";
  const copy = document.createElement("span");
  copy.className = "project-post-delete-message";
  copy.textContent = message || t("core.cardDeleteConfirmation.deleteThisCard");
  const actions = document.createElement("div");
  actions.className = "project-post-card-overlay-actions project-post-delete-actions";
  const cancel = actionButton(t("core.cardDeleteConfirmation.cancel"), () => { overlay.remove(); onCancel?.(); });
  const remove = actionButton(confirmLabel, async () => {
    remove.disabled = cancel.disabled = true;
    remove.textContent = t("core.cardDeleteConfirmation.deleting");
    try {
      const result = await onConfirm?.();
      if (result !== false || !overlay.isConnected) return;
    } catch {
      // The owner reports the failure; leave the confirmation available to retry.
    }
    remove.disabled = cancel.disabled = false;
    remove.textContent = confirmLabel;
  });
  remove.classList.add("danger");
  actions.append(cancel, remove);
  overlay.append(copy, actions);
  overlay.onclick = event => event.stopPropagation();
  overlay.onkeydown = event => { if (event.key === "Escape") cancel.click(); };
  card.append(overlay);
  cancel.focus();
  return overlay;
}

function actionButton(text, handler) {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  item.onclick = event => { event.stopPropagation(); handler?.(); };
  return item;
}
