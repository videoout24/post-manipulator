import {
  applyRichTextFormat,
  insertRichText,
  replaceRichTextRange,
  sliceRichText,
  richTextLength,
  richTextToPlain,
  richTextRangeHasFormat,
  richTextFormatAtPosition,
  richTextFormatMetadataAtPosition,
  removeRichTextFormat,
  toggleRichTextFormat,
  wrapRichTextWithFormats
} from "../core/RichText.js?v=1.5.9";
import {
  DATE_TIME_FORMAT_OPTIONS,
  dateTimeFormatMetadata,
  defaultDateTimeLocal,
  listAnchors,
  unixTimeToDateTimeLocal
} from "../core/SemanticRichText.js?v=1.5.9";
import { SessionTextareaSizing } from "./SessionTextareaSizing.js?v=1.5.9";
import { createDateTimePicker } from "./DateTimePicker.js?v=1.5.9";
import { randomUUID } from "../core/Random.js?v=1.5.9";
import { firstHeadingText } from "../project/ProjectGraphReconciler.js?v=1.5.9";
import { findLinkRelationAtRange, findLinkRelationById } from "../links/LinkRelationAst.js?v=1.5.9";
import { AVAILABLE_EMOJIS } from "./EmojiCatalog.js?v=1.7.6";
import { projectMapEntryText } from "../project/ProjectMapText.js?v=1.7.11";

export class BlockInspector {
  constructor({ root, registry, controller, formulaTemplates = null, richTextContext = null, projectContext = null, emojiPreferences = null, events = null }) {
    this.root = root;
    this.registry = registry;
    this.controller = controller;
    this.formulaTemplates = formulaTemplates;
    this.richTextContext = richTextContext || { active: null };
    this.projectContext = projectContext;
    this.emojiPreferences = emojiPreferences;
    this.events = events;
    this.textareaSizing = new SessionTextareaSizing();
    this.richTextStates = new Map();
    this.pendingRelationFocus = null;
    this.events?.on?.("links:source-opened", ({ relation } = {}) => this.focusLinkedRelation(relation));
    this.editorRenderers = new Map([
      ["text", ctx => this.makeScalarEditor(ctx)],
      ["textarea", ctx => this.makeScalarEditor(ctx)],
      ["number", ctx => this.makeScalarEditor(ctx)],
      ["checkbox", ctx => this.makeScalarEditor(ctx)],
      ["select", ctx => this.makeScalarEditor(ctx)],
      ["url", ctx => this.makeScalarEditor(ctx)],
      ["color", ctx => this.makeScalarEditor(ctx)],
      ["media", ctx => this.makeMediaEditor(ctx)],
      ["json", ctx => this.makeJsonEditor(ctx)],
      ["formula", ctx => this.makeFormulaEditor(ctx)],
      ["location", ctx => this.makeLocationEditor(ctx)],
      ["rich-text", ctx => this.makeRichTextEditor(ctx)],
      ["list-items", ctx => this.makeListItemsEditor(ctx)],
      ["table", ctx => this.makeTableEditor(ctx)],
      ["block-array", ctx => this.makeBlockArrayEditor(ctx)],
      ["datetime-local", ctx => this.makeDateTimeEditor(ctx)],
      ["anchor-select", ctx => this.makeAnchorSelectEditor(ctx)],
      ["project-map-slots", ctx => this.makeProjectMapSlotsEditor(ctx)],
      ["project-map-select", ctx => this.makeProjectMapSelectEditor(ctx)],
      ["project-backlink-relation", ctx => this.makeProjectBacklinkRelationEditor(ctx)]
    ]);
  }

  renderInline(node) {
    const host = document.createElement("div");
    host.className = "inline-block-properties";
    if (!node) return host;

    const def = this.registry.get(node.type);
    const parent = this.controller.tree?.parentOf?.(node.id) || null;
    let bindings = this.registry.propertyBindings(def).filter(binding => !binding.readOnly);
    bindings = this.filterInlineBindings(node, parent, bindings);

    if (node.type === "anchor") {
      host.classList.add("inline-anchor-editor");
      for (const binding of bindings) host.append(this.renderProperty(node, binding));
      return host;
    }

    if (!bindings.length) {
      host.classList.add("inline-block-properties-empty");
      return host;
    }

    const groups = groupBindings(bindings);
    for (const [groupName, groupBindingsList] of groups) {
      host.append(this.renderPropertyGroup(node, groupName, groupBindingsList, { inline: true }));
    }
    this.decorateInlineNode(node, host, def);
    return host;
  }

  filterInlineBindings(node, parent, bindings) {
    const hidden = new Set();
    if (node.type === "heading") hidden.add("heading.size");
    if (node.type === "preformatted") hidden.add("preformatted.language");
    if (node.type === "details") hidden.add("details.isOpen");
    if (["photo", "video", "animation"].includes(node.type)) hidden.add("media.hasSpoiler");
    if (node.type === "table") {
      hidden.add("table.isBordered");
      hidden.add("table.isStriped");
      hidden.add("table.isCompact");
    }
    if (["collage", "slideshow"].includes(parent?.type) && ["photo", "video"].includes(node.type)) {
      hidden.add("content.caption");
      hidden.add("content.captionCredit");
    }
    return bindings.filter(binding => !hidden.has(binding.property));
  }

  decorateInlineNode(node, host, def) {
    if (node.type === "heading") {
      const binding = this.registry.propertyBindings(def).find(item => item.property === "heading.size");
      this.mountPropertyLabelAccessory(host, "content.text", makeHeadingSizeControl(node, binding, this.controller));
    }
    if (node.type === "mathematical_expression") {
      const control = host.querySelector(".formula-import-control");
      this.mountPropertyLabelAccessory(host, "math.expression", control);
    }
    if (node.type === "preformatted") {
      const binding = this.registry.propertyBindings(def).find(item => item.property === "preformatted.language");
      this.mountPropertyLabelAccessory(host, "content.text", makeCompactTextControl(node, binding, this.controller, "Язык"));
    }
    if (node.type === "details") {
      const binding = this.registry.propertyBindings(def).find(item => item.property === "details.isOpen");
      this.mountPropertyLabelAccessory(host, "details.summary", makeCompactCheckbox(node, binding, this.controller, "Открыт"));
    }
    if (["text_link", "url_button"].includes(node.type)) {
      const controls = document.createElement("span");
      controls.append(makeUrlPrefixControl());
      const relation = document.createElement("button");
      relation.type = "button";
      relation.className = "link-relation-button link-relation-block-button";
      relation.textContent = "↗";
      decorateBlockRelationButton(relation, node);
      relation.onclick = () => this.events?.emit?.("links:block-target-requested", { nodeId: node.id, text: String(node.props?.text || "") });
      controls.append(relation);
      this.mountPropertyLabelAccessory(host, "link.url", controls);
    }
  }

  mountPropertyLabelAccessory(host, propertyId, control) {
    if (!control) return;
    const row = host.querySelector(`.prop[data-property="${cssEscape(propertyId)}"] > .prop-label-row`);
    if (!row) return;
    control.classList.add("prop-label-accessory");
    row.append(control);
  }

  render(node) {
    if (!this.root) return;
    this.root.innerHTML = "";
    if (!node) {
      this.root.innerHTML = '<div class="empty">Выберите блок</div>';
      return;
    }

    const def = this.registry.get(node.type);
    const title = document.createElement("h3");
    title.textContent = def?.name || node.type;
    this.root.append(title);

    const bindings = this.registry.propertyBindings(def);
    if (!bindings.length) {
      const empty = document.createElement("div");
      empty.className = "empty inspector-empty-properties";
      empty.textContent = "У блока нет редактируемых свойств";
      this.root.append(empty);
    } else {
      const groups = groupBindings(bindings);
      for (const [groupName, groupBindingsList] of groups) {
        this.root.append(this.renderPropertyGroup(node, groupName, groupBindingsList));
      }
    }

    const capabilities = document.createElement("div");
    capabilities.className = "inspector-capabilities";
    capabilities.textContent = `${bindings.length} свойств из общего реестра`;
    this.root.append(capabilities);

    const actions = document.createElement("div");
    actions.className = "inspector-actions";
    const dup = document.createElement("button");
    dup.textContent = "Дублировать";
    dup.onclick = () => this.controller.duplicateSelected();
    const del = document.createElement("button");
    del.textContent = "Удалить";
    del.onclick = () => this.controller.removeSelected();
    actions.append(dup, del);
    this.root.append(actions);
  }

  renderPropertyGroup(node, groupName, bindings, { inline = false } = {}) {
    const groupCollapsed = bindings.some(binding => binding.groupCollapsed === true);
    const collapsible = inline || groupCollapsed;
    const richBindings = bindings.filter(binding => this.isRichTextSchema(binding));
    const regularBindings = bindings.filter(binding => !this.isRichTextSchema(binding));

    const section = document.createElement(collapsible ? "details" : "section");
    section.className = "property-group" + (collapsible ? " property-group-collapsible" : "") + (inline ? " property-group-inline" : "");
    if (collapsible) section.open = inline ? !groupCollapsed : false;

    if (collapsible) {
      const summary = document.createElement("summary");
      summary.className = "property-group-title property-group-summary";
      const title = document.createElement("span");
      title.textContent = groupName;
      const state = document.createElement("span");
      state.className = "property-group-state";
      state.textContent = this.groupCompactState(node, bindings);
      summary.append(title, state);
      section.append(summary);
    } else {
      const header = document.createElement("div");
      header.className = "property-group-title";
      header.textContent = groupName;
      section.append(header);
    }

    const dateTimeBindings = this.dateTimeBlockBindings(node, bindings);
    if (dateTimeBindings) {
      section.append(this.renderDateTimeBlockFields(node, dateTimeBindings));
      return section;
    }

    // Two or more RichText properties in the same semantic group share one formatting
    // toolbar. The individual fields stay explicitly collapsible and the toolbar
    // always targets the active field.
    if (richBindings.length >= 2) {
      section.append(this.renderSharedRichTextProperties(node, richBindings));
    } else {
      for (const binding of richBindings) section.append(this.renderProperty(node, binding));
    }
    for (const binding of regularBindings) section.append(this.renderProperty(node, binding));
    return section;
  }

  dateTimeBlockBindings(node, bindings) {
    if (node?.type !== "date_time") return null;
    const dateTime = bindings.find(binding => binding.key === "dateTime");
    const dateTimeFormat = bindings.find(binding => binding.key === "dateTimeFormat");
    return dateTime && dateTimeFormat ? { dateTime, dateTimeFormat } : null;
  }

  renderDateTimeBlockFields(node, { dateTime, dateTimeFormat }) {
    const wrap = document.createElement("div");
    wrap.className = "prop date-time-block-fields";
    const format = document.createElement("select");
    format.className = "date-time-picker-format";
    format.title = dateTimeFormat.label || "Формат отображения даты и времени";
    format.setAttribute("aria-label", format.title);
    for (const option of dateTimeFormat.options || dateTimeFormat.values || []) {
      const value = typeof option === "object" ? option.value : option;
      const label = typeof option === "object" ? option.label : option;
      const item = document.createElement("option");
      item.value = value;
      item.textContent = label;
      format.append(item);
    }
    format.value = node.props?.[dateTimeFormat.key] ?? dateTimeFormat.default ?? "";
    format.disabled = !!dateTimeFormat.readOnly;
    format.addEventListener("change", () => {
      this.controller.updateNodeProperty(node.id, dateTimeFormat.key, format.value, { inspectorSource: true });
    });

    wrap.append(createDateTimePicker({
      value: node.props?.[dateTime.key] ?? dateTime.default ?? "",
      label: dateTime.label || "Дата и время",
      disabled: !!dateTime.readOnly,
      accessory: format,
      onChange: value => {
        this.controller.updateNodeProperty(node.id, dateTime.key, value, { inspectorSource: true });
      }
    }));
    return wrap;
  }

  isRichTextSchema(schema) {
    const editor = this.registry.properties?.editorFor(schema) || schema.editor || schema.type;
    return editor === "rich-text" || schema.type === "rich-text";
  }

  groupCompactState(node, bindings) {
    const present = bindings.filter(binding => {
      const value = node.props?.[binding.key];
      if (typeof value === "string") return value.trim() !== "";
      return value !== undefined && value !== null && value !== false;
    }).length;
    if (!present) return "не задан";
    return `${present}/${bindings.length} заполнено`;
  }

  renderSharedRichTextProperties(node, bindings) {
    const wrap = document.createElement("div");
    wrap.className = "shared-rich-group";

    const styleBox = document.createElement("div");
    styleBox.className = "shared-rich-style-box";
    const styleHead = document.createElement("div");
    styleHead.className = "shared-rich-style-head";
    const styleTitle = document.createElement("strong");
    styleTitle.textContent = "Стили";
    const activeLabel = document.createElement("span");
    activeLabel.textContent = "разверните поле";
    styleHead.append(styleTitle, activeLabel);
    const toolbar = document.createElement("div");
    toolbar.className = "rich-text-toolbar shared-rich-toolbar";
    const empty = document.createElement("span");
    empty.className = "shared-rich-empty";
    empty.textContent = "Форматирование применяется к активному полю";
    toolbar.append(empty);
    const configHost = document.createElement("div");
    configHost.className = "format-config-host shared-format-config-host";
    styleBox.append(styleHead, toolbar, configHost);
    wrap.append(styleBox);

    let activeState = null;
    const fieldPanels = [];
    const activate = (state, binding, panel) => {
      if (!state) return;
      activeState = state;
      for (const item of fieldPanels) item.classList.toggle("active", item === panel);
      activeLabel.textContent = binding.label || binding.key;
      toolbar.innerHTML = "";
      configHost.innerHTML = "";
      // Parameter editors must live in the shared style block as well.
      state.configHost = configHost;
      this.renderRichTextToolbar(toolbar, () => activeState);
    };

    bindings.forEach(binding => {
      const panel = document.createElement("details");
      panel.className = "shared-rich-field";
      fieldPanels.push(panel);
      const summary = document.createElement("summary");
      summary.className = "shared-rich-field-summary";
      const label = document.createElement("span");
      label.textContent = binding.label || binding.key;
      const valueHint = document.createElement("span");
      const plain = richTextToPlain(node.props?.[binding.key] ?? binding.default ?? "").trim();
      valueHint.textContent = plain ? (plain.length > 34 ? `${plain.slice(0, 34)}…` : plain) : "пусто";
      summary.append(label, valueHint);
      panel.append(summary);

      let readyState = null;
      const editor = this.makeRichTextEditor({
        node,
        schema: binding,
        value: node.props?.[binding.key],
        getCurrent: () => node.props?.[binding.key],
        onChange: next => {
          this.controller.updateNodeProperty(node.id, binding.key, next, { inspectorSource: true });
          const nextPlain = richTextToPlain(next ?? "").trim();
          valueHint.textContent = nextPlain ? (nextPlain.length > 34 ? `${nextPlain.slice(0, 34)}…` : nextPlain) : "пусто";
        },
        hideToolbar: true,
        onActivate: state => activate(state, binding, panel),
        onReady: state => { readyState = state; }
      });
      panel.append(editor);
      if (binding.hint) {
        const hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = binding.hint;
        panel.append(hint);
      }
      panel.addEventListener("toggle", () => {
        if (panel.open && readyState) activate(readyState, binding, panel);
      });
      wrap.append(panel);
    });

    return wrap;
  }

  renderProperty(node, schema) {
    const wrap = document.createElement("div");
    wrap.className = "prop";
    wrap.dataset.property = schema.property || "";

    const labelRow = document.createElement("div");
    labelRow.className = "prop-label-row";
    const label = document.createElement("label");
    label.textContent = schema.label || schema.key;
    labelRow.append(label);

    if (schema.property && !schema.inline) {
      const id = document.createElement("code");
      id.className = "property-id";
      id.textContent = schema.property;
      id.title = "ID свойства в общем PropertyRegistry";
      labelRow.append(id);
    }
    wrap.append(labelRow);

    const value = node.props?.[schema.key];
    wrap.append(this.makeEditor({
      node,
      schema,
      value,
      getCurrent: () => node.props?.[schema.key],
      onChange: next => this.controller.updateNodeProperty(node.id, schema.key, next, { inspectorSource: true })
    }));

    if (schema.hint) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = schema.hint;
      wrap.append(hint);
    }
    if (schema.scope && schema.scope !== "telegram") {
      const scope = document.createElement("div");
      scope.className = "property-scope";
      scope.textContent = schema.scope === "editor" ? "editor property" : schema.scope;
      wrap.append(scope);
    }
    return wrap;
  }

  makeEditor(ctx) {
    const editor = this.registry.properties?.editorFor(ctx.schema) || ctx.schema.editor || ctx.schema.type || "text";
    const renderer = this.editorRenderers.get(editor);
    if (renderer) return renderer({ ...ctx, editor });

    const fallback = document.createElement("div");
    fallback.className = "unsupported-editor";
    fallback.append(this.makeJsonEditor({ ...ctx, editor: "json" }));
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = `Неизвестный editor: ${editor}. Использован универсальный JSON fallback.`;
    fallback.append(note);
    return fallback;
  }

  makeProjectMapSlotsEditor({ value, onChange, node, schema }) {
    if (this.projectContext?.isLinearProject?.() && this.projectContext?.isRootMapNode?.(node?.id)) {
      return this.makeLinearProjectMapSlotsEditor({ value, node });
    }
    const wrap = document.createElement("div");
    wrap.className = "project-map-slots-editor";
    const list = document.createElement("div");
    list.className = "project-map-slots-list";
    const getPosts = () => this.projectContext?.snapshot?.().project?.posts || [];
    const current = Array.isArray(value) ? structuredClone(value) : [];

    const commit = (next, { structural = false } = {}) => {
      const normalized = next.map(slot => ({
        id: String(slot?.id || `slot_${randomUUID()}`),
        targetPostId: slot?.targetPostId ? String(slot.targetPostId) : null,
        text: String(slot?.text || ""),
        ...(slot?.derivedFromPostId ? { derivedFromPostId: String(slot.derivedFromPostId) } : {})
      }));
      if (structural && node?.id && schema?.key) {
        this.controller.updateNodeProperty(node.id, schema.key, normalized, { inspectorSource: false });
      } else onChange?.(normalized);
    };

    current.forEach((slot, index) => {
      const row = document.createElement("div");
      row.className = "project-map-slot-row";
      const number = document.createElement("span");
      number.className = "project-map-slot-number";
      number.textContent = String(index + 1);

      const fields = document.createElement("div");
      fields.className = "project-map-slot-fields";
      const text = document.createElement("input");
      text.type = "text";
      text.placeholder = "Название пункта";
      text.value = slot?.text || "";
      text.readOnly = Boolean(slot?.targetPostId);
      text.title = slot?.targetPostId
        ? "Текст связан с первым Heading целевого поста и обновляется автоматически"
        : "Для пустого слота можно задать временный текст; после привязки он будет заменён Heading поста";
      text.addEventListener("input", () => {
        current[index].text = text.value;
        commit(current);
      });

      const target = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "▫️ Не связан";
      target.append(empty);
      const state = this.projectContext?.snapshot?.() || {};
      const activePostId = state.activePostId || null;
      const currentMapId = String(node?.props?.mapId || "").trim();
      const usedByOtherSlots = new Set(current
        .filter((_, slotIndex) => slotIndex !== index)
        .map(item => item?.targetPostId)
        .filter(Boolean));
      for (const post of getPosts()) {
        if (post.id === activePostId) continue; // Map cannot point to its own host post.
        if (usedByOtherSlots.has(post.id) && post.id !== slot?.targetPostId) continue;
        // A manual Back to Map already reserves this (post,map) pair. The current
        // slot stays visible until reconciliation, but no new relation can create
        // a second backlink to the same Map.
        if (post.id !== slot?.targetPostId && currentMapId && postHasManualBacklink(post, currentMapId)) continue;
        const option = document.createElement("option");
        option.value = post.id;
        option.textContent = post.title || post.id;
        target.append(option);
      }
      target.value = slot?.targetPostId || "";
      target.addEventListener("change", () => {
        const targetPostId = target.value || null;
        current[index].targetPostId = targetPostId;
        if (!targetPostId) {
          current[index].text = "";
          delete current[index].derivedFromPostId;
        } else {
          const targetPost = getPosts().find(post => post.id === targetPostId);
          current[index].text = firstHeadingText(targetPost?.messageAst);
          current[index].derivedFromPostId = targetPostId;
        }
        commit(current, { structural: true });
      });
      fields.append(text, target);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Удалить слот";
      remove.addEventListener("click", () => {
        current.splice(index, 1);
        commit(current, { structural: true });
      });
      row.append(number, fields, remove);
      list.append(row);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "project-map-slot-add";
    add.textContent = "+ Слот";
    add.addEventListener("click", () => {
      current.push({ id: `slot_${randomUUID()}`, targetPostId: null, text: "" });
      commit(current, { structural: true });
    });

    if (!current.length) {
      const empty = document.createElement("div");
      empty.className = "project-map-slots-empty";
      empty.textContent = "Map может быть пустой. Добавьте слот, когда понадобится связь с постом.";
      list.append(empty);
    }
    wrap.append(list, add);
    return wrap;
  }

  makeLinearProjectMapSlotsEditor({ value, node }) {
    const wrap = document.createElement("div");
    wrap.className = "project-map-slots-editor project-map-slots-editor-linear";
    const list = document.createElement("div");
    list.className = "project-map-slots-list";
    const slots = Array.isArray(value) ? value : [];
    const project = this.projectContext?.snapshot?.().project;

    slots.forEach((slot, index) => {
      const post = project?.posts?.find(item => String(item.id) === String(slot?.targetPostId)) || null;
      const row = document.createElement("div");
      row.className = "project-map-slot-row project-map-slot-row-linear";
      const number = document.createElement("span");
      number.className = "project-map-slot-number";
      number.textContent = String(index + 1);
      row.append(number);
      const label = document.createElement("input");
      label.type = "text";
      label.className = "project-map-slot-fixed-title";
      label.value = post?.title || slot?.text || "Пост";
      label.title = "Название синхронизировано с обязательным заголовком этого поста";
      label.setAttribute("aria-label", `Название поста ${index + 1}`);
      label.addEventListener("change", async () => {
        const title = label.value.trim();
        if (!title || !post?.id) {
          label.value = post?.title || slot?.text || "Пост";
          return;
        }
        try {
          await this.projectContext?.renamePost?.(post.id, title);
        } catch (error) {
          label.value = post?.title || slot?.text || "Пост";
          this.controller.events?.emit?.("ui:error", { message: error?.message || String(error), error });
        }
      });
      const controls = document.createElement("div");
      controls.className = "project-map-slot-order-controls";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.title = "Переместить пост выше";
      up.disabled = index === 0;
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "Переместить пост ниже";
      down.disabled = index === slots.length - 1;
      const move = async direction => {
        up.disabled = down.disabled = true;
        try {
          await this.projectContext?.movePostInMap?.(slot?.targetPostId, direction);
        } catch (error) {
          this.controller.events?.emit?.("ui:error", { message: error?.message || String(error), error });
          if (row.isConnected) {
            up.disabled = index === 0;
            down.disabled = index === slots.length - 1;
          }
        }
      };
      up.onclick = () => move("up");
      down.onclick = () => move("down");
      controls.append(up, down);
      row.append(label, controls);
      list.append(row);
    });

    if (!slots.length) {
      const empty = document.createElement("div");
      empty.className = "project-map-slots-empty";
      empty.textContent = "Добавьте первый пост проекта из карты.";
      list.append(empty);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "project-map-slot-add";
    add.textContent = "+ Слот";
    add.title = "Создать следующий пост и слот в карте проекта";
    add.onclick = async () => {
      try {
        await this.projectContext?.createPostFromMapSlot?.(`Пост ${slots.length + 2}`);
      } catch (error) {
        this.controller.events?.emit?.("ui:error", { message: error?.message || String(error), error });
      }
    };
    wrap.append(list, add);
    return wrap;
  }

  makeProjectMapSelectEditor({ value, onChange, node }) {
    if (this.projectContext?.isLinearProject?.()) {
      return this.makeFixedProjectRelationNotice("Карта стартового поста назначается автоматически.");
    }
    const select = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Выберите Map…";
    select.append(empty);
    const project = this.projectContext?.currentProjectSnapshot?.() || this.projectContext?.snapshot?.().project;
    const state = this.projectContext?.snapshot?.() || {};
    const activePost = project?.posts?.find(post => post.id === state.activePostId) || null;
    const usedByOtherBacklinks = backlinkTargetsInPost(activePost?.messageAst, node?.id);
    for (const item of listProjectMaps(project)) {
      if (usedByOtherBacklinks.has(item.mapId) && item.mapId !== value) continue;
      const option = document.createElement("option");
      option.value = item.mapId;
      option.textContent = `${item.postTitle} · Map ${item.order}`;
      select.append(option);
    }
    select.value = value || "";
    select.addEventListener("change", () => onChange?.(select.value));
    if (!project) {
      select.disabled = true;
      select.title = "Back to Map требует активный Project";
    }
    return select;
  }

  makeProjectBacklinkRelationEditor({ value, node }) {
    if (this.projectContext?.isLinearProject?.()) {
      return this.makeFixedProjectRelationNotice("Этот блок всегда ведёт к карте стартового поста проекта.");
    }
    const wrap = document.createElement("div");
    wrap.className = "project-backlink-relation-editor";

    const row = document.createElement("div");
    row.className = "project-backlink-relation-row";
    const mapField = document.createElement("label");
    const mapCaption = document.createElement("span");
    mapCaption.textContent = "Целевая Map";
    const mapSelect = document.createElement("select");
    mapField.append(mapCaption, mapSelect);

    const slotField = document.createElement("label");
    const slotCaption = document.createElement("span");
    slotCaption.textContent = "Slot";
    const slotSelect = document.createElement("select");
    slotField.append(slotCaption, slotSelect);
    row.append(mapField, slotField);
    wrap.append(row);

    const project = this.projectContext?.currentProjectSnapshot?.() || this.projectContext?.snapshot?.().project;
    const state = this.projectContext?.snapshot?.() || {};
    const activePostId = String(state.activePostId || "");
    const activePost = project?.posts?.find(post => String(post.id) === activePostId) || null;
    if (!project || !activePostId || !activePost) {
      mapSelect.disabled = true;
      slotSelect.disabled = true;
      mapSelect.title = "Back to Map требует активный Project post";
      return wrap;
    }

    const maps = listProjectMaps(project);
    const current = resolveBacklinkRelation(project, activePostId, node);
    const currentMapId = current.mapId || String(value || "").trim();
    const currentSlotId = current.slotId || String(node?.props?.targetSlotId || "").trim();
    const usedByOtherBacklinks = backlinkTargetsInPost(activePost.messageAst, node?.id);
    let selectedMapId = currentMapId;

    const mapEmpty = document.createElement("option");
    mapEmpty.value = "";
    mapEmpty.textContent = "Выберите Map…";
    mapSelect.append(mapEmpty);

    for (const item of maps) {
      if (String(item.postId) === activePostId) continue;
      if (usedByOtherBacklinks.has(item.mapId) && item.mapId !== currentMapId) continue;
      const hasFreeSlot = item.slots.some(slot => !String(slot?.targetPostId || "").trim());
      if (!hasFreeSlot && item.mapId !== currentMapId) continue;
      const option = document.createElement("option");
      option.value = item.mapId;
      option.textContent = `${item.postTitle} · Map ${item.order}`;
      mapSelect.append(option);
    }

    if (currentMapId && ![...mapSelect.options].some(option => option.value === currentMapId)) {
      const missing = document.createElement("option");
      missing.value = currentMapId;
      missing.textContent = `⚠ Текущая Map · ${currentMapId}`;
      mapSelect.append(missing);
    }
    mapSelect.value = currentMapId || "";

    const renderSlots = () => {
      slotSelect.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = selectedMapId ? "Выберите Slot…" : "Сначала выберите Map";
      slotSelect.append(empty);
      const map = maps.find(item => item.mapId === selectedMapId);
      if (!map) {
        slotSelect.disabled = true;
        slotSelect.value = "";
        return;
      }

      for (let index = 0; index < map.slots.length; index += 1) {
        const slot = map.slots[index] || {};
        const targetPostId = String(slot.targetPostId || "").trim();
        const isCurrent = map.mapId === currentMapId && String(slot.id || "") === currentSlotId;
        const belongsToActivePost = targetPostId === activePostId;
        if (targetPostId && !belongsToActivePost && !isCurrent) continue;
        if (belongsToActivePost && !isCurrent && map.mapId !== currentMapId) continue;
        const option = document.createElement("option");
        option.value = String(slot.id || "");
        option.textContent = projectMapSlotLabel(map, slot, index);
        slotSelect.append(option);
      }
      slotSelect.disabled = false;
      const preferred = selectedMapId === currentMapId ? currentSlotId : "";
      slotSelect.value = [...slotSelect.options].some(option => option.value === preferred) ? preferred : "";
    };

    mapSelect.addEventListener("change", () => {
      selectedMapId = mapSelect.value || "";
      renderSlots();
    });

    slotSelect.addEventListener("change", async () => {
      const targetSlotId = slotSelect.value || "";
      if (!selectedMapId || !targetSlotId) return;
      mapSelect.disabled = true;
      slotSelect.disabled = true;
      try {
        await this.projectContext?.rebindBacklinkRelation?.(node.id, {
          targetMapId: selectedMapId,
          targetSlotId
        });
      } catch (error) {
        this.controller.events?.emit?.("ui:error", { message: error?.message || String(error), error });
        mapSelect.disabled = false;
        slotSelect.disabled = false;
      }
    });

    renderSlots();
    return wrap;
  }

  makeFixedProjectRelationNotice(message) {
    const note = document.createElement("div");
    note.className = "project-backlink-relation-fixed";
    note.textContent = message;
    return note;
  }

  makeScalarEditor({ schema, value, onChange, editor, node }) {
    let input;
    if (editor === "select" || schema.type === "enum") {
      input = document.createElement("select");
      for (const option of schema.options || schema.values || []) {
        const optionValue = typeof option === "object" ? option.value : option;
        const optionLabel = typeof option === "object" ? option.label : option;
        const o = document.createElement("option");
        o.value = optionValue;
        o.textContent = optionLabel;
        input.append(o);
      }
      input.value = value ?? schema.default ?? "";
    } else if (editor === "checkbox" || schema.type === "boolean") {
      const row = document.createElement("label");
      row.className = "boolean-editor";
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!(value ?? schema.default);
      const state = document.createElement("span");
      state.textContent = input.checked ? "Да" : "Нет";
      input.addEventListener("change", () => {
        state.textContent = input.checked ? "Да" : "Нет";
        onChange?.(input.checked);
      });
      input.disabled = !!schema.readOnly;
      row.append(input, state);
      return row;
    } else if (editor === "textarea") {
      input = document.createElement("textarea");
      input.value = value ?? schema.default ?? "";
    } else {
      input = document.createElement("input");
      input.type = editor === "datetime-local" ? "datetime-local" : editor === "url" ? "url" :
        editor === "number" || ["integer", "number"].includes(schema.type) ? "number" :
        editor === "color" ? "color" : "text";
      if (schema.min != null) input.min = schema.min;
      if (schema.max != null) input.max = schema.max;
      if (schema.step != null) input.step = schema.step;
      input.value = value ?? schema.default ?? "";
    }

    const commit = () => onChange?.(parseInputValue(schema, input));
    input.addEventListener("change", commit);
    if (input.tagName === "TEXTAREA" || ["text", "url"].includes(input.type)) input.addEventListener("input", commit);
    if (schema.readOnly && (input.tagName === "INPUT" || input.tagName === "TEXTAREA")) input.readOnly = true;
    else input.disabled = !!schema.readOnly;
    if (input.tagName === "TEXTAREA" && !schema.readOnly) {
      this.textareaSizing.attach(input, {
        key: `${node?.id || "global"}:${schema.key || schema.property || "textarea"}`,
        defaultRows: defaultRowsFor(schema),
        minRows: 1
      });
    }
    return input;
  }

  makeDateTimeEditor({ schema, value, onChange }) {
    return createDateTimePicker({
      value: value ?? schema.default ?? "",
      label: schema.label || "Дата и время",
      disabled: !!schema.readOnly,
      onChange
    });
  }

  makeAnchorSelectEditor({ value, onChange, schema }) {
    const select = document.createElement("select");
    select.className = "anchor-select-editor";
    const top = document.createElement("option");
    top.value = "";
    top.textContent = "В начало сообщения";
    select.append(top);
    const anchors = listAnchors(this.controller.tree);
    for (const anchor of anchors) {
      const option = document.createElement("option");
      option.value = anchor.id;
      option.textContent = `⚓ ${anchor.label}`;
      select.append(option);
    }
    if (value && !anchors.some(anchor => anchor.id === value)) {
      const missing = document.createElement("option");
      missing.value = value;
      missing.textContent = "⚠ Якорь удалён";
      select.append(missing);
    }
    select.value = value ?? schema.default ?? "";
    select.disabled = !!schema.readOnly;
    select.addEventListener("change", () => onChange?.(select.value));
    return select;
  }

  makeMediaEditor(ctx) {
    const wrap = document.createElement("div");
    wrap.className = "media-editor";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "file_id, URL или attach://...";
    input.value = typeof ctx.value === "string" ? ctx.value : stringifyCompact(ctx.value ?? ctx.schema.default ?? "");
    input.addEventListener("input", () => ctx.onChange?.(input.value));
    if (ctx.schema.readOnly) input.disabled = true;
    wrap.append(input);

    const meta = document.createElement("div");
    meta.className = "editor-meta-line";
    meta.textContent = ctx.schema.mediaKind ? `media: ${ctx.schema.mediaKind}` : "InputMedia / file_id / URL";
    wrap.append(meta);
    return wrap;
  }

  makeJsonEditor({ schema, value, onChange, node = null }) {
    const wrap = document.createElement("div");
    wrap.className = "structured-editor json-editor";
    const textarea = document.createElement("textarea");
    textarea.spellcheck = false;
    textarea.value = stringifyStructured(value ?? schema.default ?? {});
    const status = document.createElement("div");
    status.className = "structured-status";

    const commit = () => {
      try {
        const parsed = textarea.value.trim() === "" ? null : JSON.parse(textarea.value);
        textarea.classList.remove("invalid");
        status.textContent = "JSON корректен";
        onChange?.(parsed);
      } catch (error) {
        textarea.classList.add("invalid");
        status.textContent = "JSON: " + error.message;
      }
    };
    textarea.addEventListener("change", commit);
    textarea.disabled = !!schema.readOnly;
    if (!schema.readOnly) this.textareaSizing.attach(textarea, {
      key: `${node?.id || "global"}:${schema.key || schema.property || "json"}`, defaultRows: 3, minRows: 1
    });
    wrap.append(textarea, status);
    return wrap;
  }

  makeBlockArrayEditor({ schema, value, onChange, node = null }) {
    const blocks = Array.isArray(value) ? structuredClone(value) : [];
    const wrap = document.createElement("details");
    wrap.className = "block-array-editor";
    const summary = document.createElement("summary");
    summary.textContent = `Структурные блоки: ${blocks.length}`;
    wrap.append(summary);

    const textarea = document.createElement("textarea");
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(blocks, null, 2);
    textarea.placeholder = '[{"type":"paragraph","text":"..."}]';
    const status = document.createElement("div");
    status.className = "structured-status";
    textarea.addEventListener("change", () => {
      try {
        const parsed = JSON.parse(textarea.value || "[]");
        if (!Array.isArray(parsed)) throw new Error("ожидается массив блоков");
        textarea.classList.remove("invalid");
        summary.textContent = `Структурные блоки: ${parsed.length}`;
        status.textContent = "Структура корректна";
        onChange?.(parsed);
      } catch (error) {
        textarea.classList.add("invalid");
        status.textContent = error.message;
      }
    });
    textarea.disabled = !!schema.readOnly;
    if (!schema.readOnly) this.textareaSizing.attach(textarea, {
      key: `${node?.id || "global"}:${schema.key || schema.property || "block-array"}`, defaultRows: 3, minRows: 1
    });
    wrap.append(textarea, status);
    return wrap;
  }

  makeFormulaEditor({ schema, value, onChange, node }) {
    const wrap = document.createElement("div");
    wrap.className = "formula-editor";
    const textarea = document.createElement("textarea");
    textarea.className = "formula-expression";
    textarea.value = value ?? schema.default ?? "";
    textarea.spellcheck = false;
    textarea.addEventListener("input", () => onChange?.(textarea.value));
    this.textareaSizing.attach(textarea, { key: `${node?.id || "formula"}:expression`, defaultRows: 3, minRows: 1 });

    const categoryStrip = chipStrip("Категории");
    const subcategoryStrip = chipStrip("Подкатегории");
    const templateStrip = chipStrip("Шаблоны");
    const importControl = document.createElement("span");
    importControl.className = "formula-import-control";
    const importButton = document.createElement("button");
    importButton.type = "button"; importButton.textContent = "Импорт JSON";
    importButton.title = 'Формат: {"sections":[{"title":"Химия","templates":[{"label":"Количество вещества","latex":"n=\\\\frac{m}{M}"}]}]}';
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = ".json,application/json"; fileInput.hidden = true;
    importControl.append(importButton, fileInput);
    wrap.append(categoryStrip.wrap, subcategoryStrip.wrap, templateStrip.wrap, textarea, importControl);

    let library = { sections: [] }, sectionIndex = 0, subsectionIndex = 0;
    const renderChips = () => {
      const sections = library.sections || [];
      sectionIndex = Math.min(sectionIndex, Math.max(0, sections.length - 1));
      const section = sections[sectionIndex];
      const subs = section?.subsections || [];
      subsectionIndex = Math.min(subsectionIndex, Math.max(0, subs.length - 1));
      const sub = subs[subsectionIndex];
      renderChipButtons(categoryStrip.body, sections.map(item => item.title), sectionIndex, index => { sectionIndex = index; subsectionIndex = 0; renderChips(); });
      renderChipButtons(subcategoryStrip.body, subs.map(item => item.title), subsectionIndex, index => { subsectionIndex = index; renderChips(); });
      templateStrip.body.innerHTML = "";
      for (const template of sub?.templates || []) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "formula-chip template-chip"; button.textContent = template.label;
        button.title = template.latex;
        button.onclick = () => {
          const cursor = textarea.selectionStart ?? textarea.value.length;
          const value = textarea.value;
          textarea.value = `${value.slice(0, cursor)}${template.latex}${value.slice(cursor)}`;
          const nextCursor = cursor + template.latex.length;
          textarea.focus();
          textarea.setSelectionRange(nextCursor, nextCursor);
          onChange?.(textarea.value);
          this.textareaSizing.refresh(textarea, { key: `${node?.id || "formula"}:expression`, defaultRows: 3, minRows: 1 });
        };
        templateStrip.body.append(button);
      }
      categoryStrip.wrap.hidden = !sections.length;
      subcategoryStrip.wrap.hidden = !subs.length;
      templateStrip.wrap.hidden = !(sub?.templates || []).length;
    };
    const loadLibrary = async () => {
      library = this.formulaTemplates ? await this.formulaTemplates.getLibrary() : { sections: [] };
      renderChips();
    };
    loadLibrary().catch(error => this.controller.reportError(`LaTeX templates: ${error.message}`));
    const offTemplates = this.formulaTemplates?.events?.on?.("formula:templates-updated", nextLibrary => {
      if (!wrap.isConnected) { offTemplates?.(); return; }
      library = nextLibrary || { sections: [] };
      sectionIndex = subsectionIndex = 0;
      renderChips();
    });
    const importFormulaFile = async file => {
      if (!file || !this.formulaTemplates) return;
      try {
        const result = await this.formulaTemplates.importJson(await file.text(), { source: `file:${file.name}` });
        library = result.library; sectionIndex = subsectionIndex = 0; renderChips();
      } catch (error) { this.controller.reportError(`LaTeX JSON: ${error.message}`); }
    };
    importButton.onclick = () => fileInput.click();
    fileInput.addEventListener("change", async () => {
      await importFormulaFile(fileInput.files?.[0]);
      fileInput.value = "";
    });
    attachLocalFileDrop(importControl, file => /\.json$/i.test(file.name || "") || /json/i.test(file.type || ""), importFormulaFile);
    return wrap;
  }

  makeLocationEditor({ schema, value, onChange }) {
    const current = value && typeof value === "object" ? value : schema.default || {};
    const wrap = document.createElement("div");
    wrap.className = "location-editor";
    const lat = numericField("Широта", current.latitude ?? 0, -90, 90);
    const lon = numericField("Долгота", current.longitude ?? 0, -180, 180);
    const accuracy = numericField("Точность, м", current.horizontal_accuracy ?? "", 0, 1500);
    const commit = () => {
      const next = {
        latitude: Number(lat.input.value || 0),
        longitude: Number(lon.input.value || 0)
      };
      if (accuracy.input.value !== "") next.horizontal_accuracy = Number(accuracy.input.value);
      onChange?.(next);
    };
    for (const field of [lat, lon, accuracy]) {
      field.input.addEventListener("change", commit);
      field.input.disabled = !!schema.readOnly;
    }
    wrap.append(lat.wrap, lon.wrap, accuracy.wrap);
    return wrap;
  }

  makeRichTextEditor({ node = null, schema, value, onChange, getCurrent, hideToolbar = false, onActivate = null, onReady = null }) {
    const wrap = document.createElement("div");
    wrap.className = "rich-text-editor" + (hideToolbar ? " rich-text-editor-shared" : "");
    const textarea = document.createElement("textarea");
    textarea.value = richTextToPlain(value ?? schema.default ?? "");
    textarea.dataset.structured = typeof value === "string" || value == null ? "false" : "true";
    textarea.disabled = !!schema.readOnly;

    const status = document.createElement("div");
    status.className = "rich-text-status";
    const statusMessage = document.createElement("span");
    statusMessage.className = "rich-text-message";
    status.append(statusMessage);
    const setStatusMessage = message => {
      statusMessage.textContent = String(message || "");
      status.classList.toggle("has-message", Boolean(statusMessage.textContent));
    };

    const configHost = document.createElement("div");
    configHost.className = "format-config-host";
    const typingSession = { enabled: false, formats: new Set(), metadata: new Map() };

    const state = {
      node,
      schema,
      textarea,
      status,
      configHost,
      getCurrent,
      onChange,
      setStatusMessage,
      typingSession,
      toolbarHost: null,
      lastPlain: textarea.value
    };
    this.registerRichTextState(state);

    const updateStatus = () => {
      status.dataset.structured = textarea.dataset.structured;
      this.refreshRichTextToolbarState(state);
    };
    state.updateStatus = updateStatus;
    state.insertValue = inserted => {
      if (schema.readOnly) return false;
      const start = textarea.selectionStart ?? richTextLength(getCurrent?.() ?? textarea.value);
      const current = getCurrent?.() ?? textarea.value;
      const payload = typeof inserted === "string" ? this.richTextInsertionPayload(state, inserted) : inserted;
      const next = insertRichText(current, start, payload);
      onChange?.(next);
      textarea.value = richTextToPlain(next);
      state.lastPlain = textarea.value;
      if (typeof payload !== "string") textarea.dataset.structured = "true";
      updateStatus();
      const nextPos = start + richTextLength(payload);
      textarea.focus();
      textarea.setSelectionRange(nextPos, nextPos);
      this.refreshRichTextToolbarState(state, next);
      return true;
    };

    const activate = () => {
      if (typingSession.enabled) this.syncRichTypingStylesFromSelection(state);
      this.refreshRichTextToolbarState(state);
      if (node?.type === "paragraph") this.richTextContext.active = state;
      onActivate?.(state);
    };
    textarea.addEventListener("focus", activate);
    textarea.addEventListener("mouseup", activate);
    textarea.addEventListener("keyup", activate);
    textarea.addEventListener("select", activate);

    if (!hideToolbar && (schema.formats || []).length && this.registry.properties?.formatting) {
      const toolbar = document.createElement("div");
      toolbar.className = "rich-text-toolbar";
      this.renderRichTextToolbar(toolbar, () => state);
      wrap.append(toolbar);
    }

    textarea.addEventListener("input", () => {
      const nextPlain = textarea.value;
      const current = getCurrent?.() ?? state.lastPlain ?? "";
      const previousPlain = state.lastPlain ?? richTextToPlain(current);
      const delta = textDelta(previousPlain, nextPlain);
      const inserted = this.richTextInsertionPayload(state, delta.inserted);
      const needsStructured = typeof inserted !== "string" || textarea.dataset.structured === "true" || typeof current !== "string";

      if (!needsStructured) {
        onChange?.(nextPlain);
        textarea.dataset.structured = "false";
      } else {
        const next = replaceRichTextRange(current, delta.start, delta.oldEnd, inserted);
        onChange?.(next);
        textarea.dataset.structured = "true";
      }
      state.lastPlain = nextPlain;
      updateStatus();
      activate();
    });

    this.textareaSizing.attach(textarea, {
      key: `${node?.id || "global"}:${schema.key || schema.property || "rich"}`,
      defaultRows: defaultRowsFor(schema),
      minRows: 1
    });
    wrap.append(configHost, textarea, status);
    updateStatus();
    onReady?.(state);
    return wrap;
  }

  renderRichTextToolbar(host, stateGetter) {
    const state = stateGetter?.();
    const formats = state?.schema?.formats || [];
    if (!formats.length || !this.registry.properties?.formatting) {
      const empty = document.createElement("span");
      empty.className = "shared-rich-empty";
      empty.textContent = "Для этого поля форматирование не объявлено";
      host.append(empty);
      return;
    }

    state.toolbarHost = host;
    const appendFormatButton = formatId => {
      const format = this.registry.properties.formatting.get(formatId);
      if (!format) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rich-format-button";
      button.dataset.formatId = format.id;
      button.textContent = format.shortLabel || format.label || format.id;
      button.title = format.label || format.id;
      button.onmousedown = e => e.preventDefault();
      button.onclick = () => this.applyRichTextFormatToState(stateGetter?.(), format);
      host.append(button);
    };
    for (const formatId of formats) {
      if (formatId === "date_time") continue;
      appendFormatButton(formatId);
    }

    const inherit = document.createElement("label");
    inherit.className = "rich-style-inherit";
    inherit.title = "Печатать новый текст с активными стилями";
    const inheritInput = document.createElement("input");
    inheritInput.type = "checkbox";
    inheritInput.checked = !!state.typingSession?.enabled;
    inheritInput.addEventListener("change", () => {
      const currentState = stateGetter?.();
      if (!currentState) return;
      currentState.typingSession ||= { enabled: false, formats: new Set(), metadata: new Map() };
      currentState.typingSession.enabled = inheritInput.checked;
      if (inheritInput.checked) this.syncRichTypingStylesFromSelection(currentState);
      this.refreshRichTextToolbarState(currentState);
      currentState.textarea?.focus();
    });
    const inheritText = document.createElement("span");
    inheritText.textContent = "Наследовать стили";
    inherit.append(inheritInput, inheritText);
    host.append(inherit);

    const link = document.createElement("button");
    link.type = "button";
    link.className = "rich-format-button link-relation-button rich-link-relation-button";
    link.textContent = "↗";
    link.title = "Связать выделенный текст с выбранной целью";
    link.onmousedown = event => event.preventDefault();
    link.onclick = () => this.requestLinkRelation(stateGetter?.());
    host.append(link);

    if (formats.includes("date_time")) appendFormatButton("date_time");
    const emoji = document.createElement("button");
    emoji.type = "button";
    emoji.className = "rich-format-button emoji-toggle-button";
    emoji.textContent = "😀";
    emoji.title = "Emoji";
    emoji.setAttribute("aria-label", "Открыть emoji");
    emoji.onmousedown = e => e.preventDefault();
    emoji.setAttribute("aria-expanded", "false");
    emoji.onclick = () => this.toggleEmojiPicker(stateGetter?.());
    if (state) state.emojiToggleButton = emoji;
    host.append(emoji);
    this.refreshRichTextToolbarState(state);
  }

  requestLinkRelation(state) {
    const start = Number(state?.textarea?.selectionStart ?? 0);
    const end = Number(state?.textarea?.selectionEnd ?? start);
    if (!state?.node?.id) {
      state?.setStatusMessage?.("Выделите текст, который нужно связать");
      return false;
    }
    const value = state.getCurrent?.() ?? state.textarea.value;
    const existing = findLinkRelationAtRange(value, start, end);
    if (end <= start && !existing) {
      state?.setStatusMessage?.("Выделите текст, который нужно связать");
      return false;
    }
    const text = richTextToPlain(value).slice(start, end);
    this.events?.emit?.("links:select-target-requested", {
      source: { nodeId: state.node.id, property: state.schema.key || "text", start, end, text },
    });
    state.setStatusMessage?.(existing ? "Связь разрывается…" : "Связь добавляется…");
    return true;
  }

  registerRichTextState(state) {
    const key = richTextStateKey(state?.node?.id, state?.schema?.key);
    if (!key) return;
    this.richTextStates.set(key, state);
    const pending = this.pendingRelationFocus;
    if (!pending || !sameRichTextSource(pending.source, state)) return;
    this.pendingRelationFocus = null;
    queueMicrotask(() => this.focusLinkedRelation(pending));
  }

  focusLinkedRelation(relation) {
    const source = relation?.source || {};
    if (source.mode && source.mode !== "inline") return false;
    const key = richTextStateKey(source.nodeId, source.property);
    if (!key) return false;
    const state = this.richTextStates.get(key);
    if (!state || state.textarea?.isConnected === false) {
      this.pendingRelationFocus = structuredClone(relation);
      return false;
    }
    const value = state.getCurrent?.() ?? state.textarea?.value ?? "";
    const marker = findLinkRelationById(value, relation?.id);
    if (!marker) return false;
    this.pendingRelationFocus = null;
    const fieldPanel = state.textarea?.closest?.("details");
    if (fieldPanel) fieldPanel.open = true;
    state.textarea?.focus?.();
    state.textarea?.setSelectionRange?.(marker.start, marker.end);
    this.refreshRichTextToolbarState(state, value);
    state.setStatusMessage?.("Связь выбрана. Нажмите ↗, чтобы разорвать.");
    return true;
  }

  richTextSelectionStyleIds(state, valueOverride = undefined) {
    const active = new Set();
    if (!state?.textarea || !this.registry.properties?.formatting) return active;
    const current = valueOverride ?? state.getCurrent?.() ?? state.textarea.value;
    const start = state.textarea.selectionStart ?? 0;
    const end = state.textarea.selectionEnd ?? start;
    for (const formatId of state.schema?.formats || []) {
      const format = this.registry.properties.formatting.get(formatId);
      if (!format?.wrapperField) continue;
      const applied = start === end
        ? richTextFormatAtPosition(current, start, format)
        : richTextRangeHasFormat(current, start, end, format);
      if (applied) active.add(format.id);
    }
    return active;
  }

  syncRichTypingStylesFromSelection(state, valueOverride = undefined) {
    if (!state?.typingSession?.enabled) return;
    const current = valueOverride ?? state.getCurrent?.() ?? state.textarea?.value ?? "";
    const formats = this.richTextSelectionStyleIds(state, current);
    const metadata = new Map();
    for (const formatId of formats) {
      const format = this.registry.properties?.formatting?.get(formatId);
      if (!format?.inheritMetadata) continue;
      const value = richTextFormatMetadataAtPosition(current, state.textarea?.selectionStart ?? 0, format);
      if (value) metadata.set(formatId, value);
      else formats.delete(formatId);
    }
    state.typingSession.formats = formats;
    state.typingSession.metadata = metadata;
  }

  refreshRichTextToolbarState(state, valueOverride = undefined) {
    const host = state?.toolbarHost;
    if (!host) return;
    const visual = state.typingSession?.enabled
      ? new Set(state.typingSession.formats || [])
      : this.richTextSelectionStyleIds(state, valueOverride);
    for (const button of host.querySelectorAll(".rich-format-button[data-format-id]")) {
      const active = visual.has(button.dataset.formatId);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const inheritInput = host.querySelector(".rich-style-inherit input[type=checkbox]");
    if (inheritInput) inheritInput.checked = !!state.typingSession?.enabled;
    const relationButton = host.querySelector(".rich-link-relation-button");
    if (relationButton) {
      const value = valueOverride ?? state.getCurrent?.() ?? state.textarea?.value ?? "";
      const start = Number(state.textarea?.selectionStart ?? 0);
      const end = Number(state.textarea?.selectionEnd ?? start);
      decorateRichRelationButton(relationButton, findLinkRelationAtRange(value, start, end));
    }
  }

  richTextInsertionPayload(state, inserted) {
    if (!inserted || !state?.typingSession?.enabled || !state.typingSession.formats?.size) return inserted;
    const definitions = [];
    for (const formatId of state.schema?.formats || []) {
      if (!state.typingSession.formats.has(formatId)) continue;
      const format = this.registry.properties?.formatting?.get(formatId);
      if (format?.wrapperField && !format.inheritMetadata) definitions.push(format);
    }
    let next = definitions.length ? wrapRichTextWithFormats(inserted, definitions) : inserted;
    for (const formatId of state.schema?.formats || []) {
      if (!state.typingSession.formats.has(formatId)) continue;
      const format = this.registry.properties?.formatting?.get(formatId);
      const metadata = state.typingSession.metadata?.get(formatId);
      if (!format?.inheritMetadata || !metadata) continue;
      next = applyRichTextFormat(next, 0, richTextLength(next), format, metadata);
    }
    return next;
  }

  closeEmojiPicker(state, { focus = false } = {}) {
    if (!state) return false;
    const picker = state.configHost?.querySelector?.(".basic-emoji-picker");
    if (picker) picker.remove();
    state.emojiToggleButton?.classList.remove("active");
    state.emojiToggleButton?.setAttribute("aria-expanded", "false");
    if (focus) state.textarea?.focus();
    return Boolean(picker);
  }

  ensureEmojiPickerLifecycle(state) {
    if (!state?.textarea || state.emojiLifecycleBound) return;
    state.emojiLifecycleBound = true;
    state.textarea.addEventListener("beforeinput", event => {
      if (!state.configHost?.querySelector?.(".basic-emoji-picker")) return;
      const inputType = String(event.inputType || "");
      if (inputType.startsWith("insert")) this.closeEmojiPicker(state);
    });
    state.textarea.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.configHost?.querySelector?.(".basic-emoji-picker")) return;
      event.preventDefault();
      event.stopPropagation();
      this.closeEmojiPicker(state, { focus: true });
    });
  }

  toggleEmojiPicker(state) {
    if (!state || state.schema?.readOnly) return;
    const host = state.configHost;
    if (!host) return;
    this.ensureEmojiPickerLifecycle(state);
    if (host.querySelector(".basic-emoji-picker")) {
      this.closeEmojiPicker(state, { focus: true });
      return;
    }

    // The config strip is shared with format-specific controls, so opening Emoji
    // intentionally replaces any previous transient config UI.
    host.innerHTML = "";
    const picker = document.createElement("div");
    picker.className = "basic-emoji-picker";
    const emojiCatalog = this.emojiPreferences?.orderedCatalog?.(AVAILABLE_EMOJIS) || AVAILABLE_EMOJIS;
    for (const value of emojiCatalog) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = value;
      button.title = `${value} · Ctrl+клик — переместить в начало`;
      button.onmousedown = e => e.preventDefault();
      button.onclick = event => {
        if (!event.ctrlKey) {
          state.insertValue?.(value);
          return;
        }
        event.preventDefault();
        picker.prepend(button);
        picker.scrollTop = 0;
        this.emojiPreferences?.promote?.(value)?.catch?.(() => {});
      };
      picker.append(button);
    }
    host.append(picker);
    state.emojiToggleButton?.classList.add("active");
    state.emojiToggleButton?.setAttribute("aria-expanded", "true");

    picker.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeEmojiPicker(state, { focus: true });
    });
  }

  applyRichTextFormatToState(state, format) {
    if (!state || state.schema?.readOnly) return;
    const { textarea } = state;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const applyBatch = state.applyFormatBatch && state.shouldApplyFormatBatch?.() !== false;

    const applyRange = metadata => {
      const current = state.getCurrent?.() ?? textarea.value;
      const next = this.applyRichTextFormatValue(current, start, end, format, metadata);
      state.onChange?.(next);
      textarea.value = richTextToPlain(next);
      state.lastPlain = textarea.value;
      textarea.dataset.structured = "true";
      state.configHost.innerHTML = "";
      textarea.focus();
      textarea.setSelectionRange(start, end);
      if (state.typingSession?.enabled) this.syncRichTypingStylesFromSelection(state, next);
      this.refreshRichTextToolbarState(state, next);
      state.setStatusMessage?.("");
    };

    if (format.metadataEditor === "date-time") {
      if (!applyBatch && start === end) {
        if (!state.typingSession?.enabled) {
          state.setStatusMessage?.("Сначала выделите текст или включите наследование стилей");
          textarea.focus();
          return;
        }
        state.typingSession.formats ||= new Set();
        state.typingSession.metadata ||= new Map();
        if (state.typingSession.formats.has(format.id)) {
          state.typingSession.formats.delete(format.id);
          state.typingSession.metadata.delete(format.id);
          state.setStatusMessage?.("");
          this.refreshRichTextToolbarState(state);
          textarea.focus();
          return;
        }
        this.renderDateTimeFormatConfig(state.configHost, format, metadata => {
          state.typingSession.formats.add(format.id);
          state.typingSession.metadata.set(format.id, metadata);
          state.configHost.innerHTML = "";
          state.setStatusMessage?.("");
          this.refreshRichTextToolbarState(state);
          textarea.focus();
        }, () => {
          state.configHost.innerHTML = "";
          textarea.focus();
        });
        return;
      }

      const current = state.getCurrent?.() ?? textarea.value;
      const currentMetadata = richTextFormatMetadataAtPosition(current, start, format);
      const apply = metadata => {
        if (applyBatch) {
          state.applyFormatBatch(format, metadata);
          state.configHost.innerHTML = "";
          state.setStatusMessage?.("");
        } else applyRange(metadata);
      };
      this.renderDateTimeFormatConfig(state.configHost, format, apply, () => {
        state.configHost.innerHTML = "";
        textarea.focus();
        textarea.setSelectionRange(start, end);
      }, currentMetadata);
      return;
    }

    if (applyBatch) {
      const apply = metadata => state.applyFormatBatch(format, metadata);
      if (format.fields?.length) this.renderFormatConfig(state.configHost, format, apply, () => { state.configHost.innerHTML = ""; });
      else apply({});
      return;
    }

    // Wrapper formats are true toggles. With inheritance enabled and no selection,
    // the same buttons control the style-state used for subsequent typing.
    if (format.wrapperField && start === end) {
      if (!state.typingSession?.enabled) {
        state.setStatusMessage?.("Сначала выделите текст");
        textarea.focus();
        return;
      }
      state.typingSession.formats ||= new Set();
      if (state.typingSession.formats.has(format.id)) state.typingSession.formats.delete(format.id);
      else state.typingSession.formats.add(format.id);
      state.setStatusMessage?.("");
      this.refreshRichTextToolbarState(state);
      textarea.focus();
      return;
    }

    if (format.fields?.length) {
      this.renderFormatConfig(state.configHost, format, applyRange, () => {
        state.configHost.innerHTML = "";
        textarea.focus();
        textarea.setSelectionRange(start, end);
      });
    } else {
      applyRange({});
    }
  }

  applyRichTextFormatValue(value, start, end, format, metadata = {}) {
    if (format?.replaceExisting) {
      const selected = sliceRichText(value, start, end);
      const withoutCurrentFormat = removeRichTextFormat(selected, format);
      const nextSelection = applyRichTextFormat(
        withoutCurrentFormat,
        0,
        richTextLength(withoutCurrentFormat),
        format,
        metadata
      );
      return replaceRichTextRange(value, start, end, nextSelection);
    }
    return format?.wrapperField
      ? toggleRichTextFormat(value, start, end, format, metadata)
      : applyRichTextFormat(value, start, end, format, metadata);
  }

  renderDateTimeFormatConfig(host, format, onApply, onCancel, initialMetadata = null) {
    host.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "format-config format-date-time-config";

    const timestampField = document.createElement("div");
    timestampField.className = "format-config-registry-field";
    const timestampLabel = document.createElement("div");
    timestampLabel.className = "nested-field-head";
    timestampLabel.textContent = "Дата и время";
    const initialDateTime = unixTimeToDateTimeLocal(initialMetadata?.unix_time) || defaultDateTimeLocal();
    let dateTime = initialDateTime;
    const display = document.createElement("select");
    display.className = "date-time-picker-format";
    display.title = "Формат отображения даты и времени";
    display.setAttribute("aria-label", display.title);
    for (const option of [{ value: "", label: "Оставить текст" }, ...DATE_TIME_FORMAT_OPTIONS]) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      display.append(item);
    }
    display.value = String(initialMetadata?.date_time_format || "");
    timestampField.append(timestampLabel, createDateTimePicker({
      value: initialDateTime,
      label: "Выбрать дату и время timestamp",
      accessory: display,
      onChange: value => {
        dateTime = value;
        timestampField.classList.remove("required-missing");
      }
    }));
    panel.append(timestampField);

    const error = document.createElement("div");
    error.className = "format-config-error";
    panel.append(error);
    const actions = document.createElement("div");
    actions.className = "format-config-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Отмена";
    cancel.onclick = onCancel;
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Применить";
    apply.onclick = () => {
      const metadata = dateTimeFormatMetadata({ dateTime, date_time_format: display.value });
      const invalid = !Number.isFinite(new Date(String(dateTime || "")).getTime());
      timestampField.classList.toggle("required-missing", invalid);
      if (invalid) {
        error.textContent = "Выберите дату и время";
        return;
      }
      error.textContent = "";
      onApply(metadata);
    };
    actions.append(cancel, apply);
    panel.append(actions);
    host.append(panel);
  }

  renderFormatConfig(host, format, onApply, onCancel) {
    host.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "format-config";
    const title = document.createElement("div");
    title.className = "format-config-title";
    title.textContent = format.label || format.id;
    panel.append(title);

    const commandSchema = this.registry.properties?.get(`format.${format.id}`);
    const fields = this.registry.properties?.resolveFields(commandSchema?.fields || []) || [];
    const values = {};

    for (const field of fields) {
      if (field.default !== undefined) values[field.key] = structuredClone(field.default);
      const fieldWrap = document.createElement("div");
      fieldWrap.className = "format-config-registry-field";
      const head = document.createElement("div");
      head.className = "nested-field-head";
      const label = document.createElement("span");
      label.textContent = field.label || field.key;
      const id = document.createElement("code");
      id.textContent = field.property || "";
      head.append(label, id);
      fieldWrap.append(head);
      fieldWrap.append(this.makeEditor({
        schema: field,
        value: values[field.key],
        getCurrent: () => values[field.key],
        onChange: next => { values[field.key] = next; fieldWrap.classList.remove("required-missing"); }
      }));
      panel.append(fieldWrap);
    }

    const error = document.createElement("div");
    error.className = "format-config-error";
    panel.append(error);

    const actions = document.createElement("div");
    actions.className = "format-config-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Отмена";
    cancel.onclick = onCancel;
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Применить";
    apply.onclick = () => {
      let invalid = false;
      [...panel.querySelectorAll(".format-config-registry-field")].forEach((fieldWrap, index) => {
        const field = fields[index];
        const value = values[field.key];
        const missing = field.required && (value === undefined || value === null || value === "");
        fieldWrap.classList.toggle("required-missing", !!missing);
        invalid ||= !!missing;
      });
      if (invalid) {
        error.textContent = "Заполните обязательные параметры";
        return;
      }
      error.textContent = "";
      onApply(structuredClone(values));
    };
    actions.append(cancel, apply);
    panel.append(actions);
    host.append(panel);
  }

  makeListItemsEditor({ schema, value, onChange, node }) {
    let items = Array.isArray(value) ? structuredClone(value) : [];
    const wrap = document.createElement("div");
    wrap.className = "list-compact-editor";

    // The list keeps one textarea as its source of truth: one logical textarea line
    // equals one Telegram list item. A single left marker rail mirrors logical-line
    // heights and shows the selected item marker: numbering, checkbox, or both.
    // Checked state remains independent on each item.
    let checkboxMode = items.some(item => !!item?.has_checkbox);
    const first = items[0] || {};
    let markerType = markerTypeForCheckboxMode(first.type, checkboxMode);
    let start = Number.isFinite(Number(first.value)) ? Math.trunc(Number(first.value)) : 1;

    const itemsLayout = document.createElement("div");
    itemsLayout.className = "list-items-layout";

    const markerRail = document.createElement("div");
    markerRail.className = "list-marker-rail";
    markerRail.hidden = !(checkboxMode || markerType);

    const textarea = document.createElement("textarea");
    textarea.className = "list-lines-input";
    textarea.placeholder = "Один элемент списка на строку";
    textarea.disabled = !!schema.readOnly;

    const mirror = document.createElement("div");
    mirror.className = "list-lines-mirror";
    mirror.setAttribute("aria-hidden", "true");

    itemsLayout.append(markerRail, textarea, mirror);

    const footer = document.createElement("div");
    footer.className = "list-compact-controls";

    const countLabel = document.createElement("span");
    countLabel.className = "list-item-count";

    const removeButton = miniButton("−", "Удалить последний элемент");
    removeButton.classList.add("list-count-button");
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "0";
    countInput.step = "1";
    countInput.className = "compact-number list-count-input";
    countInput.title = "Количество элементов списка";
    const addButton = miniButton("+", "Добавить элемент");
    addButton.classList.add("list-count-button");

    const hasCheckbox = compactCheckbox("Checkbox", checkboxMode);
    const startValue = document.createElement("input");
    startValue.type = "number";
    startValue.className = "compact-number";
    startValue.value = String(start);
    startValue.title = "Начальное числовое значение";

    const marker = document.createElement("select");
    marker.className = "compact-select";
    for (const [markerValue, label] of [["", "Маркер: нет"], ["1", "1, 2, 3"], ["a", "a, b, c"], ["A", "A, B, C"], ["i", "i, ii, iii"], ["I", "I, II, III"]]) {
      const option = document.createElement("option");
      option.value = markerValue;
      option.textContent = label;
      marker.append(option);
    }
    marker.value = markerType;

    let textareaResizeObserver = null;

    const normalizeItems = () => {
      items = items.map((item, index) => normalizeListItem(item, {
        text: listItemPlainText(item),
        checkboxMode,
        markerType,
        start,
        index
      }));
    };

    const updateControls = () => {
      countInput.value = String(items.length);
      countLabel.textContent = `Элементов: ${items.length}`;
      removeButton.disabled = !!schema.readOnly || items.length === 0;
      startValue.disabled = !!schema.readOnly || !markerType;
      marker.disabled = !!schema.readOnly || checkboxMode;
    };

    const emit = () => {
      normalizeItems();
      updateControls();
      onChange?.(structuredClone(items));
    };

    const syncTextareaFromItems = () => {
      textarea.value = items.map(listItemPlainText).join("\n");
      requestAnimationFrame(() => {
        this.textareaSizing.refresh(textarea, {
          key: `${node?.id || "list"}:items-lines`,
          defaultRows: 3,
          minRows: 1
        });
        requestAnimationFrame(syncMarkerRailGeometry);
      });
    };

    const renderMarkerRail = () => {
      markerRail.innerHTML = "";
      const railVisible = !!(checkboxMode || markerType);
      itemsLayout.classList.toggle("marker-rail-mode", railVisible);
      markerRail.classList.toggle("has-checkbox", checkboxMode);
      markerRail.classList.toggle("has-numbering", !!markerType);
      markerRail.hidden = !railVisible;
      if (!railVisible) return;

      items.forEach((item, index) => {
        const cell = document.createElement("div");
        cell.className = "list-marker-cell";
        cell.dataset.index = String(index);

        if (markerType) {
          const label = document.createElement("span");
          label.className = "list-item-marker-label";
          label.textContent = formatListMarker(markerType, item?.value ?? (start + index));
          cell.append(label);
        }

        if (checkboxMode) {
          const checked = document.createElement("input");
          checked.type = "checkbox";
          checked.className = "list-item-checked";
          checked.checked = !!item?.is_checked;
          checked.title = `Элемент ${index + 1}: отмечен`;
          checked.disabled = !!schema.readOnly;
          checked.addEventListener("change", () => {
            const current = items[index] && typeof items[index] === "object" ? structuredClone(items[index]) : {};
            current.has_checkbox = true;
            current.is_checked = checked.checked;
            items[index] = current;
            emit();
          });
          cell.append(checked);
        }

        markerRail.append(cell);
      });
      requestAnimationFrame(syncMarkerRailGeometry);
    };

    const syncMarkerRailGeometry = () => {
      if (!(checkboxMode || markerType) || !textarea.isConnected || !markerRail.isConnected) return;
      const style = getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 14) * 1.35;
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
      const contentWidth = Math.max(1, textarea.clientWidth - paddingLeft - paddingRight);

      mirror.style.width = `${contentWidth}px`;
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.fontStyle = style.fontStyle;
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.letterSpacing = style.letterSpacing;
      mirror.style.wordSpacing = style.wordSpacing;
      mirror.style.textTransform = style.textTransform;
      mirror.style.textIndent = style.textIndent;
      mirror.style.tabSize = style.tabSize;

      mirror.innerHTML = "";
      for (const item of items) {
        const line = document.createElement("div");
        line.className = "list-lines-mirror-line";
        line.textContent = listItemPlainText(item) || "\u200b";
        mirror.append(line);
      }

      markerRail.style.setProperty("--list-line-height", `${lineHeight}px`);
      markerRail.style.paddingTop = `${paddingTop}px`;
      markerRail.style.paddingBottom = `${paddingBottom}px`;
      markerRail.style.height = `${Math.ceil(textarea.getBoundingClientRect().height)}px`;

      const cells = [...markerRail.children];
      const measuredLines = [...mirror.children];
      cells.forEach((cell, index) => {
        const measured = measuredLines[index]?.getBoundingClientRect().height || lineHeight;
        cell.style.height = `${Math.max(lineHeight, Math.ceil(measured))}px`;
      });
    };

    const applyTextarea = () => {
      const raw = textarea.value.replace(/\r\n?/g, "\n");
      const lines = raw === "" ? (items.length ? [""] : []) : raw.split("\n");
      items = reconcileListItemsByLines(items, lines, { checkboxMode, markerType, start });
      updateControls();
      renderMarkerRail();
      onChange?.(structuredClone(items));
      requestAnimationFrame(() => requestAnimationFrame(syncMarkerRailGeometry));
    };

    const resizeItems = nextCount => {
      const size = Math.max(0, Math.trunc(Number(nextCount) || 0));
      if (size < items.length) {
        items = items.slice(0, size);
      } else {
        while (items.length < size) {
          const index = items.length;
          items.push(normalizeListItem({}, {
            text: "",
            checkboxMode,
            markerType,
            start,
            index
          }));
        }
      }
      syncTextareaFromItems();
      renderMarkerRail();
      emit();
    };

    textarea.addEventListener("input", applyTextarea);
    removeButton.addEventListener("click", () => resizeItems(items.length - 1));
    addButton.addEventListener("click", () => resizeItems(items.length + 1));
    countInput.addEventListener("change", () => resizeItems(countInput.value));

    hasCheckbox.input.addEventListener("change", () => {
      checkboxMode = hasCheckbox.input.checked;
      markerType = markerTypeForCheckboxMode(markerType, checkboxMode);
      marker.value = markerType;
      normalizeItems();
      renderMarkerRail();
      emit();
    });

    startValue.addEventListener("change", () => {
      start = Number.isFinite(Number(startValue.value)) ? Math.trunc(Number(startValue.value)) : 1;
      startValue.value = String(start);
      normalizeItems();
      renderMarkerRail();
      emit();
    });

    marker.addEventListener("change", () => {
      markerType = marker.value;
      normalizeItems();
      renderMarkerRail();
      emit();
    });

    if (schema.readOnly) {
      for (const control of [removeButton, countInput, addButton, hasCheckbox.input, startValue, marker]) control.disabled = true;
    }

    footer.append(countLabel, removeButton, countInput, addButton, hasCheckbox.wrap, startValue, marker);
    wrap.append(itemsLayout, footer);

    normalizeItems();
    syncTextareaFromItems();
    renderMarkerRail();
    updateControls();
    this.textareaSizing.attach(textarea, { key: `${node?.id || "list"}:items-lines`, defaultRows: 3, minRows: 1 });

    if (typeof ResizeObserver === "function") {
      textareaResizeObserver = new ResizeObserver(() => {
        if (!textarea.isConnected) { textareaResizeObserver?.disconnect(); return; }
        syncMarkerRailGeometry();
      });
      textareaResizeObserver.observe(textarea);
    }
    requestAnimationFrame(() => requestAnimationFrame(syncMarkerRailGeometry));
    return wrap;
  }
  makeTableEditor({ schema, value, onChange, node }) {
    let cells = normalizeTable(value);
    if (!cells.length) cells = [[{}, {}], [{}, {}]];
    let selectedRow = 0;
    let selectedCol = 0;
    let selectedCells = new Set([tableCellKey(0, 0)]);
    let pointerSelectionHandled = false;
    const tableCtrlKeys = new Set();
    const tableTypingSession = { enabled: false, formats: new Set(), metadata: new Map() };
    const cellStates = new WeakMap();
    const fields = this.registry.properties?.resolveFields(schema.cell?.fields || []) || [];
    const wrap = document.createElement("div");
    wrap.className = "table-inline-editor";

    const toolbar = document.createElement("div");
    toolbar.className = "table-inline-toolbar";
    const dimensions = document.createElement("span");
    dimensions.className = "table-dimensions";
    const addRow = miniButton("+ строка", "Добавить строку");
    const removeRow = miniButton("− строка", "Удалить последнюю строку");
    const addCol = miniButton("+ колонка", "Добавить колонку");
    const removeCol = miniButton("− колонка", "Удалить последнюю колонку");
    const bordered = compactCheckbox("Границы", !!node?.props?.isBordered);
    const striped = compactCheckbox("Чередование", !!node?.props?.isStriped);
    const compact = compactCheckbox("Компактная", !!node?.props?.isCompact);
    const importButton = miniButton("Импорт CSV / MD", "Импортировать локальный CSV или Markdown-файл");
    importButton.className = "table-import-button";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv,.md,text/csv,text/markdown,text/plain";
    fileInput.hidden = true;
    toolbar.append(dimensions, addRow, removeRow, addCol, removeCol, bordered.wrap, striped.wrap, compact.wrap, importButton, fileInput);

    const cellControls = document.createElement("div");
    cellControls.className = "table-cell-controls";
    const cellLabel = document.createElement("strong");
    cellLabel.title = "Левый или правый Ctrl + стрелки — перейти в соседнюю ячейку";
    const navHint = document.createElement("span");
    navHint.className = "table-nav-hint";
    navHint.textContent = "L/R Ctrl + ← ↑ → ↓";
    navHint.title = "Перемещение по ячейкам таблицы";
    const mergeRow = miniButton("Объединить в строке", "Объединить выделенные соседние ячейки одной строки");
    mergeRow.className = "table-merge-row";
    const mergeColumn = miniButton("Объединить в колонке", "Объединить выделенные соседние ячейки одной колонки");
    mergeColumn.className = "table-merge-column";
    const unmerge = miniButton("Разъединить", "Разделить объединённую ячейку");
    unmerge.className = "table-unmerge";
    const applyAlignmentToAll = miniButton(
      "Ко всем ячейкам",
      "Применить выбранное горизонтальное и вертикальное выравнивание ко всем ячейкам"
    );
    applyAlignmentToAll.className = "table-apply-alignment-all";
    const align = compactSelect("align", [["left","Слева"],["center","Центр"],["right","Справа"]]);
    const valign = compactSelect("valign", [["top","Сверху"],["middle","По центру"],["bottom","Снизу"]]);
    cellControls.append(cellLabel, navHint, mergeRow, mergeColumn, unmerge, applyAlignmentToAll, align.wrap, valign.wrap);

    const formatRow = document.createElement("div");
    formatRow.className = "table-format-row";
    const formatToolbar = document.createElement("div");
    formatToolbar.className = "rich-text-toolbar table-rich-toolbar";
    const headerCell = compactCheckbox("Заголовочная", false);
    formatRow.append(formatToolbar, headerCell.wrap);
    const configHost = document.createElement("div");
    configHost.className = "format-config-host table-format-config";

    const scroller = document.createElement("div");
    scroller.className = "table-grid-scroll";
    scroller.addEventListener("wheel", event => {
      if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    }, { passive: false });
    const grid = document.createElement("div");
    grid.className = "table-live-grid";
    scroller.append(grid);
    const moveTableFocus = (rowDelta, colDelta) => {
      const nextRow = Math.max(0, Math.min(cells.length - 1, selectedRow + rowDelta));
      const nextCol = Math.max(0, Math.min(cols() - 1, selectedCol + colDelta));
      if (nextRow === selectedRow && nextCol === selectedCol) return;
      selectedRow = nextRow; selectedCol = nextCol;
      syncSelectedControls();
      const target = grid.querySelector(`textarea[data-row="${selectedRow}"][data-col="${selectedCol}"]`);
      if (!target) return;
      target.focus();
      const end = target.value.length;
      target.setSelectionRange(end, end);
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    grid.addEventListener("keydown", event => {
      if (["ControlLeft", "ControlRight"].includes(event.code)) {
        tableCtrlKeys.add(event.code);
        return;
      }
      if (!tableCtrlKeys.size) return;
      const movement = {
        ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]
      }[event.key];
      if (!movement) return;
      event.preventDefault();
      event.stopPropagation();
      moveTableFocus(...movement);
    });
    grid.addEventListener("keyup", event => { tableCtrlKeys.delete(event.code); });
    grid.addEventListener("focusout", event => {
      if (!grid.contains(event.relatedTarget)) tableCtrlKeys.clear();
    });

    wrap.append(toolbar, cellControls, formatRow, configHost, scroller);

    const commit = () => onChange?.(structuredClone(cells));
    const cols = () => Math.max(1, cells.reduce((max, row) => Math.max(max, row.length), 0));
    const ensureDimensions = (rowCount, colCount) => {
      while (cells.length < rowCount) cells.push([]);
      for (const row of cells) while (row.length < colCount) row.push(defaultObjectFromFields(fields));
    };
    const currentCell = () => cells[selectedRow]?.[selectedCol] || null;
    const selectedCoordinates = () => [...selectedCells].map(parseTableCellKey)
      .filter(({ row, col }) => cells[row]?.[col] && !cells[row][col]._mergedInto);
    const selectedCellObjects = () => selectedCoordinates().map(({ row, col }) => cells[row][col]);
    const ensureCellTextState = (textarea, row, col) => {
      if (!textarea) return null;
      let state = cellStates.get(textarea);
      if (state) return state;
      state = {
        schema: fields.find(field => field.key === "text") || { formats: [] },
        textarea,
        status: document.createElement("span"),
        configHost,
        typingSession: tableTypingSession,
        toolbarHost: null,
        lastPlain: textarea.value,
        getCurrent: () => cells[row]?.[col]?.text ?? "",
        onChange: next => {
          if (!cells[row]?.[col]) return;
          cells[row][col].text = next;
          textarea.value = richTextToPlain(next);
          state.lastPlain = textarea.value;
          commit();
          updateGridGeometry();
        },
        setStatusMessage: () => {},
        updateStatus: () => this.refreshRichTextToolbarState(state)
      };
      state.insertValue = inserted => {
        const start = textarea.selectionStart ?? richTextLength(state.getCurrent());
        const payload = typeof inserted === "string" ? this.richTextInsertionPayload(state, inserted) : inserted;
        const next = insertRichText(state.getCurrent(), start, payload);
        state.onChange(next);
        const nextPos = start + richTextLength(payload);
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
        this.refreshRichTextToolbarState(state, next);
        return true;
      };
      cellStates.set(textarea, state);
      return state;
    };
    const cellTextState = () => {
      const textarea = grid.querySelector(`textarea[data-row="${selectedRow}"][data-col="${selectedCol}"]`);
      const state = ensureCellTextState(textarea, selectedRow, selectedCol);
      if (!state) return state;
      return {
        ...state,
        // With only a caret, the active cell is the formatting target. A selected
        // text fragment remains a local override inside that cell.
        shouldApplyFormatBatch: () => selectedCells.size > 1
          || (textarea.selectionStart ?? 0) === (textarea.selectionEnd ?? 0),
        applyFormatBatch: (format, metadata = {}) => {
          const selected = selectedCellObjects();
          const allFormatted = format.wrapperField && !format.replaceExisting && selected.length > 0 && selected.every(cell => {
            const length = richTextLength(cell.text ?? "");
            return length > 0 && richTextRangeHasFormat(cell.text ?? "", 0, length, format);
          });
          for (const cell of selected) {
            const current = cell.text ?? "";
            const length = richTextLength(current);
            cell.text = allFormatted
              ? toggleRichTextFormat(current, 0, length, format, metadata)
              : this.applyRichTextFormatValue(current, 0, length, format, metadata);
          }
          commit();
          renderGrid();
        }
      };
    };

    const syncSelectedControls = () => {
      let cell = currentCell();
      if (!cell) { cells[selectedRow][selectedCol] = defaultObjectFromFields(fields); cell = cells[selectedRow][selectedCol]; }
      const selection = selectedCoordinates();
      cellLabel.textContent = selection.length > 1
        ? `Выбрано ячеек: ${selection.length}`
        : `Ячейка ${selectedRow + 1}:${selectedCol + 1}`;
      align.input.value = cell.align || "center";
      valign.input.value = cell.valign || "middle";
      headerCell.input.checked = !!cell.is_header;
      formatToolbar.innerHTML = "";
      configHost.innerHTML = "";
      this.renderRichTextToolbar(formatToolbar, cellTextState);
      for (const textarea of grid.querySelectorAll("textarea.table-cell-text")) {
        const active = selectedCells.has(tableCellKey(Number(textarea.dataset.row), Number(textarea.dataset.col)));
        textarea.closest(".table-live-cell")?.classList.toggle("selected", active);
      }
      const mergeMode = tableSelectionMergeMode(selection);
      mergeRow.hidden = mergeMode !== "row";
      mergeColumn.hidden = mergeMode !== "column";
      unmerge.hidden = Number(cell.colspan || 1) <= 1 && Number(cell.rowspan || 1) <= 1;
    };

    const updateGridGeometry = () => {
      const sample = grid.querySelector("textarea.table-cell-text");
      const sampleStyle = sample ? getComputedStyle(sample) : null;
      const sampleCellStyle = sample?.parentElement ? getComputedStyle(sample.parentElement) : null;
      const measureContext = document.createElement("canvas").getContext("2d");
      if (measureContext && sampleStyle) measureContext.font = sampleStyle.font;
      const measureLine = line => measureContext
        ? measureContext.measureText(String(line)).width
        : String(line).length * 5;
      const horizontalChrome = sampleStyle && sampleCellStyle
        ? numericCss(sampleStyle.paddingLeft)
          + numericCss(sampleStyle.paddingRight)
          + numericCss(sampleStyle.borderLeftWidth)
          + numericCss(sampleStyle.borderRightWidth)
          + numericCss(sampleCellStyle.borderLeftWidth)
          + numericCss(sampleCellStyle.borderRightWidth)
        : 10;
      const minimumWidth = measureLine("000000");
      const columnWidths = Array.from({ length: cols() }, (_, col) => {
        let max = minimumWidth;
        for (const row of cells) {
          const plain = richTextToPlain(row[col]?.text || "");
          for (const line of String(plain).split("\n")) max = Math.max(max, measureLine(line));
        }
        // One rounding pixel prevents the final glyph/caret from wrapping at the exact boundary.
        return Math.ceil(max + horizontalChrome) + 1;
      });
      grid.style.gridTemplateColumns = columnWidths.map(width => `${width}px`).join(" ");
      requestAnimationFrame(() => {
        for (const textarea of grid.querySelectorAll("textarea.table-cell-text")) {
          this.textareaSizing.refresh(textarea, {
            key: `${node?.id || "table"}:cell:${textarea.dataset.row}:${textarea.dataset.col}`,
            defaultRows: 1,
            minRows: 1,
            autoShrink: true
          });
        }
      });
    };

    const renderGrid = () => {
      ensureDimensions(Math.max(cells.length, 1), cols());
      dimensions.textContent = `${cells.length} × ${cols()}`;
      grid.innerHTML = "";
      cells.forEach((row, r) => row.forEach((cell, c) => {
        if (cell?._mergedInto) return;
        const cellWrap = document.createElement("div");
        cellWrap.className = "table-live-cell" + (cell?.is_header ? " header-cell" : "");
        cellWrap.style.gridColumn = `${c + 1} / span ${Math.max(1, Number(cell?.colspan || 1))}`;
        cellWrap.style.gridRow = `${r + 1} / span ${Math.max(1, Number(cell?.rowspan || 1))}`;
        const textarea = document.createElement("textarea");
        textarea.className = "table-cell-text";
        textarea.dataset.row = String(r); textarea.dataset.col = String(c);
        textarea.value = richTextToPlain(cell?.text || "");
        textarea.spellcheck = true;
        const activateCellText = ({ rebuildToolbar = false } = {}) => {
          selectedRow = r; selectedCol = c;
          const key = tableCellKey(r, c);
          if (!pointerSelectionHandled && !selectedCells.has(key)) selectedCells = new Set([key]);
          const state = ensureCellTextState(textarea, r, c);
          if (rebuildToolbar) syncSelectedControls();
          if (state?.typingSession?.enabled) this.syncRichTypingStylesFromSelection(state);
          this.refreshRichTextToolbarState(state);
        };
        textarea.addEventListener("pointerdown", event => {
          pointerSelectionHandled = true;
          const key = tableCellKey(r, c);
          if (event.ctrlKey || event.metaKey) {
            if (selectedCells.has(key) && selectedCells.size > 1) selectedCells.delete(key);
            else selectedCells.add(key);
          } else selectedCells = new Set([key]);
          selectedRow = r; selectedCol = c;
          syncSelectedControls();
          requestAnimationFrame(() => { pointerSelectionHandled = false; });
        });
        textarea.addEventListener("focus", () => activateCellText({ rebuildToolbar: true }));
        textarea.addEventListener("mouseup", () => activateCellText());
        textarea.addEventListener("keyup", () => activateCellText());
        textarea.addEventListener("select", () => activateCellText());
        textarea.addEventListener("input", () => {
          const state = ensureCellTextState(textarea, r, c);
          const current = cells[r][c]?.text ?? state.lastPlain ?? "";
          const previousPlain = state.lastPlain ?? richTextToPlain(current);
          const nextPlain = textarea.value;
          const delta = textDelta(previousPlain, nextPlain);
          const inserted = this.richTextInsertionPayload(state, delta.inserted);
          const next = replaceRichTextRange(current, delta.start, delta.oldEnd, inserted);
          cells[r][c].text = next;
          state.lastPlain = nextPlain;
          commit(); updateGridGeometry();
          if (state.typingSession?.enabled) this.syncRichTypingStylesFromSelection(state, next);
          this.refreshRichTextToolbarState(state, next);
        });
        cellWrap.append(textarea); grid.append(cellWrap);
        ensureCellTextState(textarea, r, c);
        this.textareaSizing.attach(textarea, {
          key: `${node?.id || "table"}:cell:${r}:${c}`,
          defaultRows: 1,
          minRows: 1,
          autoShrink: true
        });
      }));
      updateGridGeometry(); syncSelectedControls();
    };

    const updateCellField = (key, value) => {
      const selected = selectedCellObjects();
      if (!selected.length) return;
      for (const cell of selected) cell[key] = value;
      commit();
      if (key === "is_header") renderGrid();
    };
    const mergeSelection = direction => {
      const result = mergeSelectedTableCells(cells, selectedCoordinates(), direction);
      if (!result) return;
      cells = result.cells;
      selectedRow = result.anchor.row;
      selectedCol = result.anchor.col;
      selectedCells = new Set([tableCellKey(selectedRow, selectedCol)]);
      commit(); renderGrid();
    };
    align.input.addEventListener("change", () => updateCellField("align", align.input.value));
    valign.input.addEventListener("change", () => updateCellField("valign", valign.input.value));
    applyAlignmentToAll.addEventListener("click", () => {
      for (const row of cells) {
        for (const cell of row) {
          cell.align = align.input.value;
          cell.valign = valign.input.value;
        }
      }
      commit();
    });
    headerCell.input.addEventListener("change", () => updateCellField("is_header", headerCell.input.checked));
    mergeRow.addEventListener("click", () => mergeSelection("row"));
    mergeColumn.addEventListener("click", () => mergeSelection("column"));
    unmerge.addEventListener("click", () => {
      cells = unmergeTableCell(cells, selectedRow, selectedCol);
      selectedCells = new Set([tableCellKey(selectedRow, selectedCol)]);
      commit(); renderGrid();
    });
    bordered.input.addEventListener("change", () => this.controller.updateNodeProperty(node.id, "isBordered", bordered.input.checked, { inspectorSource: true }));
    striped.input.addEventListener("change", () => this.controller.updateNodeProperty(node.id, "isStriped", striped.input.checked, { inspectorSource: true }));
    compact.input.addEventListener("change", () => this.controller.updateNodeProperty(node.id, "isCompact", compact.input.checked, { inspectorSource: true }));

    addRow.onclick = () => { cells.push(Array.from({ length: cols() }, () => defaultObjectFromFields(fields))); selectedRow = cells.length - 1; selectedCol = 0; commit(); renderGrid(); };
    removeRow.onclick = () => { if (cells.length <= 1) return; cells.pop(); selectedRow = Math.min(selectedRow, cells.length - 1); commit(); renderGrid(); };
    addCol.onclick = () => { for (const row of cells) row.push(defaultObjectFromFields(fields)); selectedCol = cols() - 1; commit(); renderGrid(); };
    removeCol.onclick = () => { const count = cols(); if (count <= 1) return; for (const row of cells) row.splice(count - 1, 1); selectedCol = Math.min(selectedCol, count - 2); commit(); renderGrid(); };

    const importTableFile = async file => {
      if (!file) return;
      try {
        const text = await file.text();
        const matrix = /\.md$/i.test(file.name) ? parseMarkdownTable(text) : parseCsv(text);
        if (!matrix.length) throw new Error("Таблица не найдена");
        cells = matrix.map(row => row.map(value => ({ text: value })));
        selectedRow = selectedCol = 0; commit(); renderGrid();
      } catch (error) {
        this.controller.reportError(`Импорт таблицы: ${error.message}`);
      }
    };
    importButton.onclick = () => fileInput.click();
    fileInput.addEventListener("change", async () => {
      await importTableFile(fileInput.files?.[0]);
      fileInput.value = "";
    });
    attachLocalFileDrop(toolbar, file => /\.(csv|md)$/i.test(file.name || "") || /(csv|markdown|text)/i.test(file.type || ""), importTableFile);

    renderGrid();
    return wrap;
  }

  renderNestedField(ctx) {
    const wrap = document.createElement("div");
    wrap.className = "nested-field";
    const head = document.createElement("div");
    head.className = "nested-field-head";
    const label = document.createElement("span");
    label.textContent = ctx.schema.label || ctx.schema.key;
    const id = document.createElement("code");
    id.textContent = ctx.schema.property || "";
    head.append(label, id);
    wrap.append(head, this.makeEditor(ctx));
    if (ctx.schema.hint) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = ctx.schema.hint;
      wrap.append(hint);
    }
    return wrap;
  }
}

function richTextStateKey(nodeId, property) {
  const node = String(nodeId || "");
  const key = String(property || "");
  return node && key ? `${node}\u0000${key}` : "";
}

function sameRichTextSource(source = {}, state = {}) {
  return String(source.nodeId || "") === String(state.node?.id || "")
    && String(source.property || "") === String(state.schema?.key || "");
}

function defaultRowsFor(schema = {}) {
  const secondary = new Set(["content.credit", "content.caption", "content.captionCredit", "details.summary", "table.cell.text"]);
  if (secondary.has(schema.property)) return 1;
  if (["content.text", "thinking.text", "math.expression"].includes(schema.property)) return 3;
  return schema.editor === "textarea" ? 3 : 1;
}

function compactCheckbox(label, checked = false) {
  const wrap = document.createElement("label");
  wrap.className = "compact-check";
  const input = document.createElement("input");
  input.type = "checkbox"; input.checked = !!checked;
  const text = document.createElement("span"); text.textContent = label;
  wrap.append(input, text);
  return { wrap, input };
}

function compactNumber(label, value = 1, min = null) {
  const wrap = document.createElement("label"); wrap.className = "compact-field";
  const text = document.createElement("span"); text.textContent = label;
  const input = document.createElement("input"); input.type = "number"; input.value = value;
  if (min != null) input.min = min;
  wrap.append(text, input); return { wrap, input };
}

function compactSelect(label, options = []) {
  const wrap = document.createElement("label"); wrap.className = "compact-field";
  const text = document.createElement("span"); text.textContent = label;
  const input = document.createElement("select");
  for (const [value, caption] of options) { const option = document.createElement("option"); option.value = value; option.textContent = caption; input.append(option); }
  wrap.append(text, input); return { wrap, input };
}

function makeHeadingSizeControl(node, binding, controller) {
  if (!binding) return null;
  const wrap = document.createElement("label"); wrap.className = "rich-footer-control";
  const span = document.createElement("span"); span.textContent = "Размер";
  const select = document.createElement("select");
  for (let i = 1; i <= 6; i += 1) { const o = document.createElement("option"); o.value = i; o.textContent = `H${i}`; select.append(o); }
  select.value = String(node.props?.[binding.key] ?? binding.default ?? 2);
  select.addEventListener("change", () => controller.updateNodeProperty(node.id, binding.key, Number(select.value), { inspectorSource: true }));
  wrap.append(span, select); return wrap;
}

function makeCompactTextControl(node, binding, controller, labelText) {
  if (!binding) return null;
  const wrap = document.createElement("label"); wrap.className = "rich-footer-control rich-footer-text";
  const span = document.createElement("span"); span.textContent = labelText;
  const input = document.createElement("input"); input.type = "text"; input.value = node.props?.[binding.key] ?? binding.default ?? "";
  input.addEventListener("input", () => controller.updateNodeProperty(node.id, binding.key, input.value, { inspectorSource: true }));
  wrap.append(span, input); return wrap;
}

const URL_PREFIXES = Object.freeze(["https://", "tg://"]);

function decorateBlockRelationButton(button, node) {
  const relationId = String(node?.props?.relationId || "");
  const title = String(node?.props?.relationTargetTitle || "сообщением");
  const linked = Boolean(relationId);
  button.classList.toggle("is-linked", linked);
  button.dataset.relationId = relationId;
  button.setAttribute("aria-pressed", String(linked));
  button.title = linked
    ? linkedRelationTooltip(title, node?.props?.text)
    : "Связать с целью, выбранной кнопкой ↙";
}

function decorateRichRelationButton(button, marker) {
  const linked = Boolean(marker?.relationId);
  const title = String(marker?.value?.target_title || "сообщением");
  button.classList.toggle("is-linked", linked);
  button.dataset.relationId = marker?.relationId || "";
  button.setAttribute("aria-pressed", String(linked));
  button.title = linked
    ? linkedRelationTooltip(title, marker?.value?.text)
    : "Связать выделенный текст с целью, выбранной кнопкой ↙";
}

function linkedRelationTooltip(title, sourceText) {
  const status = `Связано с: ${title}. Нажмите, чтобы разорвать связь.`;
  const fragment = compactRelationFragment(sourceText);
  return fragment ? `${status}\nФрагмент ссылки: «${fragment}»` : status;
}

function compactRelationFragment(value) {
  const text = richTextToPlain(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const maxLength = 120;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function makeUrlPrefixControl() {
  const wrap = document.createElement("span");
  wrap.className = "url-prefix-control";
  for (const prefix of URL_PREFIXES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = prefix;
    button.title = `Подставить ${prefix}`;
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      const input = wrap.closest(".prop")?.querySelector("input");
      if (!input) return;
      input.value = applyUrlPrefix(input.value, prefix);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
    };
    wrap.append(button);
  }
  return wrap;
}

export function applyUrlPrefix(value, prefix) {
  const selected = URL_PREFIXES.includes(prefix) ? prefix : "https://";
  let rest = String(value || "").trim();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/i, "");
  if (selected.endsWith("//")) rest = rest.replace(/^\/+/, "");
  return `${selected}${rest}`;
}

export function markerTypeForCheckboxMode(markerType, checkboxMode) {
  return checkboxMode ? "" : String(markerType || "");
}

function makeCompactCheckbox(node, binding, controller, labelText) {
  if (!binding) return null;
  const control = compactCheckbox(labelText, !!(node.props?.[binding.key] ?? binding.default));
  control.wrap.classList.add("rich-footer-control");
  control.input.addEventListener("change", () => controller.updateNodeProperty(node.id, binding.key, control.input.checked, { inspectorSource: true }));
  return control.wrap;
}

export function reconcileListItemsByLines(previousItems, lines, { checkboxMode = false, markerType = "", start = 1 } = {}) {
  const previous = Array.isArray(previousItems) ? previousItems : [];
  const nextLines = Array.isArray(lines) ? lines.map(line => String(line ?? "")) : [];
  const oldLines = previous.map(listItemPlainText);

  // With the same number of logical lines, text editing must never alter checkbox
  // state: each item keeps its state by index.
  if (oldLines.length === nextLines.length) {
    return nextLines.map((text, index) => normalizeListItem(previous[index], {
      text, checkboxMode, markerType, start, index
    }));
  }

  // When lines are inserted/removed, preserve unchanged prefix/suffix items so their
  // checked state follows the logical item. New middle lines start unchecked.
  let prefix = 0;
  while (prefix < oldLines.length && prefix < nextLines.length && oldLines[prefix] === nextLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < nextLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) suffix += 1;

  const oldMiddle = previous.slice(prefix, oldLines.length - suffix);
  return nextLines.map((text, index) => {
    let source = null;
    if (index < prefix) source = previous[index];
    else if (index >= nextLines.length - suffix) {
      const offset = nextLines.length - 1 - index;
      source = previous[previous.length - 1 - offset];
    } else {
      const middleIndex = index - prefix;
      source = oldMiddle[middleIndex] || null;
    }
    return normalizeListItem(source, { text, checkboxMode, markerType, start, index });
  });
}

export function formatListMarker(type, value) {
  const n = Math.max(1, Math.trunc(Number(value) || 1));
  switch (String(type || "")) {
    case "1": return `${n}.`;
    case "a": return `${toAlphabeticMarker(n, false)}.`;
    case "A": return `${toAlphabeticMarker(n, true)}.`;
    case "i": return `${toRomanMarker(n).toLowerCase()}.`;
    case "I": return `${toRomanMarker(n)}.`;
    default: return "";
  }
}

function toAlphabeticMarker(value, upper = false) {
  let n = Math.max(1, Math.trunc(Number(value) || 1));
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return upper ? out.toUpperCase() : out;
}

function toRomanMarker(value) {
  let n = Math.max(1, Math.trunc(Number(value) || 1));
  const table = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = "";
  for (const [unit, glyph] of table) {
    while (n >= unit) { out += glyph; n -= unit; }
  }
  return out;
}

function normalizeListItem(source, { text = "", checkboxMode = false, markerType = "", start = 1, index = 0 } = {}) {
  const next = source && typeof source === "object" && !Array.isArray(source) ? structuredClone(source) : {};
  next.blocks = [{ type: "paragraph", text: String(text ?? "") }];

  if (checkboxMode) {
    next.has_checkbox = true;
    next.is_checked = !!source?.is_checked;
  } else {
    delete next.has_checkbox;
    delete next.is_checked;
  }

  if (markerType) {
    next.type = markerType;
    next.value = Math.trunc(Number(start) || 1) + index;
  } else {
    delete next.type;
    delete next.value;
  }
  return next;
}

function listItemPlainText(item) {
  const blocks = Array.isArray(item?.blocks) ? item.blocks : [];
  return blocks.map(block => {
    if (block?.props?.text != null) return richTextToPlain(block.props.text);
    if (block?.text != null) return richTextToPlain(block.text);
    return "";
  }).filter(Boolean).join(" ");
}

function chipStrip(label) {
  const wrap = document.createElement("div"); wrap.className = "formula-chip-row";
  const caption = document.createElement("span"); caption.className = "formula-chip-label"; caption.textContent = label;
  const body = document.createElement("div"); body.className = "formula-chip-scroll";
  body.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault(); body.scrollLeft += event.deltaY;
  }, { passive: false });
  wrap.append(caption, body); return { wrap, body };
}

function renderChipButtons(host, labels, activeIndex, onSelect) {
  host.innerHTML = "";
  labels.forEach((label, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "formula-chip" + (index === activeIndex ? " active" : ""); button.textContent = label;
    button.onclick = () => onSelect(index); host.append(button);
  });
}

function attachLocalFileDrop(host, accepts, onFile) {
  host.classList.add("local-file-drop");
  host.title = [host.title, "Можно перетащить локальный файл сюда"].filter(Boolean).join(" · ");
  host.addEventListener("dragover", event => {
    const file = [...(event.dataTransfer?.files || [])][0];
    if (!file || !accepts(file)) return;
    event.preventDefault();
    event.stopPropagation();
    host.classList.add("drag-active");
  });
  host.addEventListener("dragleave", event => {
    if (!host.contains(event.relatedTarget)) host.classList.remove("drag-active");
  });
  host.addEventListener("drop", async event => {
    const file = [...(event.dataTransfer?.files || [])][0];
    if (!file || !accepts(file)) return;
    event.preventDefault();
    event.stopPropagation();
    host.classList.remove("drag-active");
    await onFile(file);
  });
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const delimiter = detectCsvDelimiter(source);
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if (ch === "\n" && !quoted) { row.push(cell); if (row.some(value => String(value).trim() !== "")) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell); if (row.some(value => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function detectCsvDelimiter(source) {
  const sample = String(source || "").split("\n").find(line => line.trim()) || "";
  const candidates = [",", ";", "\t"];
  let best = ",", bestCount = -1;
  for (const delimiter of candidates) {
    const count = sample.split(delimiter).length - 1;
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

function parseMarkdownTable(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(line => line.includes("|"));
  const rows = [];
  for (const line of lines) {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

function groupBindings(bindings) {
  const groups = new Map();
  for (const binding of bindings) {
    const group = binding.group || "Общее";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(binding);
  }
  return groups;
}

function textDelta(previous, next) {
  const a = String(previous ?? "");
  const b = String(next ?? "");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd -= 1; bEnd -= 1; }
  return { start, oldEnd: aEnd, inserted: b.slice(start, bEnd) };
}

function parseInputValue(schema, input) {
  if (schema.type === "boolean") return input.checked;
  if (schema.type === "integer") return input.value === "" ? "" : Number.parseInt(input.value, 10);
  if (schema.type === "number") return input.value === "" ? "" : Number(input.value);
  return input.value;
}

function numericField(label, value, min, max) {
  const wrap = document.createElement("label");
  wrap.className = "location-field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = value;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  wrap.append(caption, input);
  return { wrap, input };
}

function stringifyStructured(value) {
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); }
    catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}

function stringifyCompact(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value ?? ""); }
}

function numericCss(value) {
  return Number.parseFloat(value) || 0;
}

function miniButton(text, title, onclick = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = title;
  if (onclick) button.onclick = onclick;
  return button;
}

function defaultObjectFromFields(fields) {
  const result = {};
  for (const field of fields || []) {
    if (field.readOnly) continue;
    if (field.default !== undefined) result[field.key] = structuredClone(field.default);
    else if (field.type === "boolean") result[field.key] = false;
    else if (field.type === "block-array") result[field.key] = [];
  }
  return result;
}

function listItemSummary(item) {
  const parts = [];
  if (item?.has_checkbox) parts.push(item.is_checked ? " ✓" : " ☐");
  if (item?.value != null && item.value !== "") parts.push(` #${item.value}`);
  if (item?.type) parts.push(` ${item.type}`);
  if (Array.isArray(item?.blocks)) parts.push(` · ${item.blocks.length} блок.`);
  return parts.join("");
}

function tableCellKey(row, col) { return `${row}:${col}`; }

function parseTableCellKey(key) {
  const [row, col] = String(key).split(":").map(Number);
  return { row, col };
}

export function tableSelectionMergeMode(selection = []) {
  if (!Array.isArray(selection) || selection.length < 2) return null;
  const rows = [...new Set(selection.map(cell => Number(cell.row)))];
  const cols = [...new Set(selection.map(cell => Number(cell.col)))];
  if (rows.length === 1) {
    const ordered = cols.sort((a, b) => a - b);
    return ordered.every((value, index) => index === 0 || value === ordered[index - 1] + 1) ? "row" : null;
  }
  if (cols.length === 1) {
    const ordered = rows.sort((a, b) => a - b);
    return ordered.every((value, index) => index === 0 || value === ordered[index - 1] + 1) ? "column" : null;
  }
  return null;
}

export function mergeSelectedTableCells(value, selection, direction = null) {
  const cells = normalizeTable(value);
  const mode = tableSelectionMergeMode(selection);
  if (!mode || (direction && direction !== mode)) return null;
  const ordered = [...selection].sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col));
  const anchor = { row: Number(ordered[0].row), col: Number(ordered[0].col) };
  const anchorCell = cells[anchor.row]?.[anchor.col];
  if (!anchorCell || ordered.some(({ row, col }) => !cells[row]?.[col] || cells[row][col]._mergedInto)) return null;
  const content = ordered.map(({ row, col }) => cells[row][col]?.text).filter(item => richTextLength(item) > 0);
  if (content.length) anchorCell.text = content.length === 1 ? structuredClone(content[0]) : content.flatMap((item, index) => index ? ["\n", structuredClone(item)] : [structuredClone(item)]);
  anchorCell.colspan = mode === "row" ? ordered.length : 1;
  anchorCell.rowspan = mode === "column" ? ordered.length : 1;
  for (const coordinate of ordered.slice(1)) {
    cells[coordinate.row][coordinate.col]._mergedInto = { row: anchor.row, col: anchor.col };
  }
  return { cells, anchor, mode };
}

export function unmergeTableCell(value, row, col) {
  const cells = normalizeTable(value);
  const anchor = cells[row]?.[col];
  if (!anchor) return cells;
  for (const sourceRow of cells) {
    for (const cell of sourceRow) {
      if (Number(cell?._mergedInto?.row) === Number(row) && Number(cell?._mergedInto?.col) === Number(col)) delete cell._mergedInto;
    }
  }
  anchor.colspan = 1;
  anchor.rowspan = 1;
  return cells;
}

function normalizeTable(value) {
  if (!Array.isArray(value)) return [];
  return value.map(row => Array.isArray(row)
    ? row.map(cell => cell && typeof cell === "object" && !Array.isArray(cell) ? structuredClone(cell) : {})
    : []);
}


function listProjectMaps(project) {
  const out = [];
  for (const post of project?.posts || []) {
    let order = 0;
    walkProjectAst(post.messageAst, node => {
      if (node.type !== "project_post_map" || !node.props?.mapId) return;
      order += 1;
      out.push({
        mapId: String(node.props.mapId),
        postId: post.id,
        postTitle: post.title || post.id,
        order,
        nodeId: node.id || null,
        props: structuredClone(node.props || {}),
        slots: structuredClone(Array.isArray(node.props?.slots) ? node.props.slots : [])
      });
    });
  }
  return out;
}

function resolveBacklinkRelation(project, activePostId, node) {
  const mapId = String(node?.props?.targetMapId || "").trim();
  const requestedSlotId = String(node?.props?.targetSlotId || "").trim();
  if (!mapId) return { mapId: "", slotId: "" };
  const map = listProjectMaps(project).find(item => item.mapId === mapId);
  if (!map) return { mapId, slotId: requestedSlotId };
  const exact = map.slots.find(slot => String(slot?.id || "") === requestedSlotId && String(slot?.targetPostId || "") === String(activePostId));
  if (exact) return { mapId, slotId: String(exact.id || "") };
  const derived = map.slots.find(slot => String(slot?.targetPostId || "") === String(activePostId));
  return { mapId, slotId: String(derived?.id || requestedSlotId || "") };
}

function projectMapSlotLabel(map, slot, index) {
  const base = projectMapEntryText(map?.props, slot, index);
  return base.trim() || `Slot ${index + 1}`;
}

function postHasManualBacklink(post, mapId) {
  let found = false;
  walkProjectAst(post?.messageAst, node => {
    if (found || node?.type !== "project_map_backlink" || node?.props?.managedByMap === true) return;
    found = String(node.props?.targetMapId || "").trim() === String(mapId || "").trim();
  });
  return found;
}

function backlinkTargetsInPost(ast, excludeNodeId = null) {
  const targets = new Set();
  walkProjectAst(ast, node => {
    if (node?.type !== "project_map_backlink" || (excludeNodeId && node.id === excludeNodeId)) return;
    const mapId = String(node.props?.targetMapId || "").trim();
    if (mapId) targets.add(mapId);
  });
  return targets;
}

function walkProjectAst(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walkProjectAst(child, fn);
}
