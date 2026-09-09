import { t } from "../i18n/index.js?v=1.8.6";

export async function deleteGalleryTopicDialog({ gallery, threadId }) {
  let info = await gallery.getTopicDeletionInfo(threadId);
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.id = "galleryTopicDeleteDialog";
    dialog.className = "app-modal-dialog";
    dialog.setAttribute("aria-labelledby", "galleryTopicDeleteTitle");
    dialog.setAttribute("aria-describedby", "galleryTopicDeleteDescription");
    const head = element("div", "dialog-head");
    const title = element("strong", "", t("gallery.topicDelete.title"));
    title.id = "galleryTopicDeleteTitle";
    const close = button("×");
    close.setAttribute("aria-label", t("core.darkDialog.close"));
    head.append(title, close);
    const body = element("div", "app-modal-dialog-body");
    const copy = element("p", "app-modal-dialog-copy");
    copy.id = "galleryTopicDeleteDescription";
    const options = element("fieldset", "gallery-topic-delete-options");
    options.setAttribute("aria-label", t("gallery.topicDelete.chooseScope"));
    const status = element("p", "gallery-topic-delete-status");
    status.setAttribute("role", "status");
    const actions = element("div", "app-modal-dialog-actions");
    const cancel = button(t("core.cardDeleteConfirmation.cancel"));
    const confirm = button(t("core.cardDeleteConfirmation.delete"), "danger");
    actions.append(cancel, confirm);
    body.append(copy, options, status, actions);
    dialog.append(head, body);

    let busy = false;
    let outcome = null;
    let botInput = null;
    let editorInput = null;
    const scopes = () => info.hasRemote && info.assetCount > 0
      ? { deleteFromBot: botInput.checked, deleteFromEditor: editorInput.checked }
      : { deleteFromBot: info.hasRemote, deleteFromEditor: true };
    const sync = () => {
      const selected = scopes();
      confirm.disabled = busy || !(selected.deleteFromBot || selected.deleteFromEditor);
      cancel.disabled = close.disabled = options.disabled = busy;
      dialog.setAttribute("aria-busy", String(busy));
    };
    const renderChoices = (selected = {}) => {
      const name = info.topic.name || `Topic ${info.threadId}`;
      copy.textContent = info.hasRemote
        ? t(info.assetCount ? "gallery.topicDelete.chooseMessage" : "gallery.topicDelete.emptyMessage", { name, count: info.assetCount })
        : t("gallery.topicDelete.localMessage", { name, count: info.assetCount });
      options.replaceChildren();
      options.hidden = !info.hasRemote || !info.assetCount;
      if (!options.hidden) {
        const choice = (scope, label, checked) => {
          const row = element("label", "gallery-topic-delete-option");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.name = scope;
          input.checked = !!checked;
          input.addEventListener("change", sync);
          row.append(input, element("span", "", label));
          options.append(row);
          return input;
        };
        botInput = choice("deleteFromBot", t("gallery.topicDelete.fromBot"), selected.deleteFromBot);
        editorInput = choice("deleteFromEditor", t("gallery.topicDelete.fromEditor"), selected.deleteFromEditor);
      }
      sync();
    };
    const dismiss = () => { if (!busy) dialog.close(); };
    close.addEventListener("click", dismiss);
    cancel.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(outcome); }, { once: true });
    confirm.addEventListener("click", async () => {
      if (busy || confirm.disabled) return;
      const selected = scopes();
      busy = true;
      sync();
      status.textContent = t("gallery.topicDelete.deleting");
      try {
        outcome = await gallery.deleteTopic(info.threadId, selected);
        dialog.close();
      } catch (error) {
        // A remote deletion can succeed even if subsequent local cleanup fails.
        // Refresh the scope so a retry describes the actual remaining folder.
        busy = false;
        try {
          info = await gallery.getTopicDeletionInfo(info.threadId);
          renderChoices(selected);
        } catch {
          sync();
          confirm.disabled = true;
        }
        status.textContent = error?.message || String(error);
      }
    });
    renderChoices();
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className = "") {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}
