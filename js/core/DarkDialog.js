import { t } from "../i18n/index.js?v=1.8.0";
/** Browser-native prompt, alert and confirm windows ignore the app theme.
 * These helpers keep short interactions inside the same dark dialog system. */
export function requestTextDialog({ title, label = t("core.darkDialog.value"), value = "", placeholder = "", submitLabel = t("core.darkDialog.save") } = {}) {
  return new Promise(resolve => {
    const dialog = createDialog(title, resolve);
    const body = document.createElement("div");
    body.className = "app-modal-dialog-body";
    const field = document.createElement("label");
    field.className = "app-modal-dialog-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(value ?? "");
    input.placeholder = placeholder;
    field.append(caption, input);
    const actions = createActions(dialog, {
      confirmLabel: submitLabel,
      onConfirm: () => dialog.close("confirm")
    });
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      dialog.close("confirm");
    });
    body.append(field, actions);
    dialog.append(body);
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm" ? input.value : null), { once: true });
    show(dialog, input);
  });
}

export function confirmDarkDialog({ title = t("core.darkDialog.confirmAction"), message, confirmLabel = t("app.continue"), danger = false } = {}) {
  return new Promise(resolve => {
    const dialog = createDialog(title, resolve);
    const body = document.createElement("div");
    body.className = "app-modal-dialog-body";
    const copy = document.createElement("p");
    copy.className = "app-modal-dialog-copy";
    copy.textContent = message || t("core.darkDialog.continue");
    const actions = createActions(dialog, {
      confirmLabel,
      danger,
      onConfirm: () => dialog.close("confirm")
    });
    body.append(copy, actions);
    dialog.append(body);
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    show(dialog, actions.querySelector(".primary, .danger"));
  });
}

export function showDarkMessage({ title = t("core.darkDialog.message"), message, closeLabel = t("core.darkDialog.gotIt") } = {}) {
  return new Promise(resolve => {
    const dialog = createDialog(title, resolve);
    const body = document.createElement("div");
    body.className = "app-modal-dialog-body";
    const copy = document.createElement("p");
    copy.className = "app-modal-dialog-copy";
    copy.textContent = message || "";
    const actions = document.createElement("div");
    actions.className = "app-modal-dialog-actions";
    const close = button(closeLabel, "primary", () => dialog.close("close"));
    actions.append(close);
    body.append(copy, actions);
    dialog.append(body);
    dialog.addEventListener("close", () => resolve(), { once: true });
    show(dialog, close);
  });
}

function createDialog(title) {
  const dialog = document.createElement("dialog");
  dialog.className = "app-modal-dialog";
  const head = document.createElement("div");
  head.className = "dialog-head";
  const heading = document.createElement("strong");
  heading.textContent = title || "Post Manipulator";
  const close = button("×", "", () => dialog.close("cancel"));
  close.setAttribute("aria-label", t("core.darkDialog.close"));
  head.append(heading, close);
  dialog.append(head);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return dialog;
}

function createActions(dialog, { confirmLabel, onConfirm, danger = false }) {
  const actions = document.createElement("div");
  actions.className = "app-modal-dialog-actions";
  actions.append(
    button(t("core.cardDeleteConfirmation.cancel"), "", () => dialog.close("cancel")),
    button(confirmLabel, danger ? "danger" : "primary", onConfirm)
  );
  return actions;
}

function button(text, className, onClick) {
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = text;
  if (className) item.className = className;
  item.addEventListener("click", onClick);
  return item;
}

function show(dialog, initialFocus) {
  dialog.showModal();
  queueMicrotask(() => initialFocus?.focus?.());
}
