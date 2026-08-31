import { showDarkMessage } from "../core/DarkDialog.js?v=1.6.5";

export class MetaBlockDialog {
  constructor({ dialog, tree, controller, metaRegistry, onCreated }) {
    this.dialog = dialog;
    this.tree = tree;
    this.controller = controller;
    this.metaRegistry = metaRegistry;
    this.onCreated = onCreated;
  }

  open() {
    if (!(this.tree.root?.children || []).length) {
      void showDarkMessage({
        title: "Canvas пуст",
        message: "Добавьте хотя бы один блок."
      });
      return;
    }
    this.dialog.showModal();
  }

  create() {
    const type = this.dialog.querySelector("#metaType").value.trim();
    const name = this.dialog.querySelector("#metaName").value.trim();
    const category = this.dialog.querySelector("#metaCategory").value.trim() || "Custom";
    const form = this.dialog.querySelector("form");
    if (!type || !name) {
      form?.reportValidity?.();
      return;
    }
    this.showCreateConfirmation({ type, name, category });
  }

  showCreateConfirmation({ type, name, category }) {
    this.dialog.querySelector(".meta-create-confirmation")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "meta-create-confirmation";
    const message = document.createElement("strong");
    message.textContent = `Создать Meta Block «${name}» из текущего Canvas?`;
    const detail = document.createElement("span");
    detail.textContent = `В шаблон войдёт ${this.tree.root?.children?.length || 0} ${pluralBlocks(this.tree.root?.children?.length || 0)} верхнего уровня.`;
    const actions = document.createElement("div");
    actions.className = "format-config-actions";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.textContent = "Отмена"; cancel.onclick = () => overlay.remove();
    const confirm = document.createElement("button");
    confirm.type = "button"; confirm.className = "primary"; confirm.textContent = "Создать";
    confirm.onclick = () => {
      this.confirmCreate({ type, name, category });
      overlay.remove();
    };
    actions.append(cancel, confirm);
    overlay.append(message, detail, actions);
    this.dialog.querySelector("form")?.append(overlay);
    cancel.focus();
  }

  confirmCreate({ type, name, category }) {

    const definition = this.metaRegistry.create({
      type, name, category,
      sourceNodeIds: (this.tree.root?.children || []).map(node => node.id),
      tree: this.tree,
      parameters: []
    });

    this.dialog.close();
    this.onCreated?.(definition);
  }
}

function pluralBlocks(count) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return "блоков";
  if (last === 1) return "блок";
  if (last > 1 && last < 5) return "блока";
  return "блоков";
}
