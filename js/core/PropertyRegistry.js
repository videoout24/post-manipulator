export class PropertyRegistry {
  constructor(formattingRegistry = null) {
    this.properties = new Map();
    this.editors = new Map();
    this.formatting = formattingRegistry;
  }

  register(id, definition = {}) {
    if (!id) throw new Error("Property definition requires id");
    const item = { id, kind: "property", label: id, group: "Общее", type: "string", editor: "text", ...structuredClone(definition) };
    this.properties.set(id, item);
    return item;
  }

  registerEditor(type, definition = {}) {
    this.editors.set(type, { type, ...structuredClone(definition) });
  }

  get(id) { return this.properties.get(id); }
  has(id) { return this.properties.has(id); }
  all() { return [...this.properties.values()]; }
  getEditor(type) { return this.editors.get(type); }

  editorFor(schema = {}) {
    return schema.editor || this.getEditor(schema.type)?.editor || schema.type || "text";
  }

  resolve(binding) {
    if (typeof binding === "string") {
      const schema = this.get(binding);
      return schema ? { property: binding, key: schema.key || lastSegment(binding), ...structuredClone(schema) } : null;
    }
    if (!binding?.property) return null;
    const base = this.get(binding.property);
    if (!base) return null;
    return {
      ...structuredClone(base),
      ...structuredClone(binding),
      property: binding.property,
      key: binding.key || base.key || lastSegment(binding.property)
    };
  }

  resolveFields(fields = []) {
    return fields.map(field => this.resolve(field)).filter(Boolean);
  }
}

function lastSegment(id) {
  return String(id).split(".").pop();
}

export function createDefaultPropertyRegistry(formattingRegistry = null) {
  const r = new PropertyRegistry(formattingRegistry);

  // Inspector renderer catalog. BlockInspector dispatches only by this registry.
  for (const [type, editor] of Object.entries({
    string: "text",
    "rich-text": "rich-text",
    integer: "number",
    number: "number",
    boolean: "checkbox",
    enum: "select",
    url: "url",
    color: "color",
    media: "media",
    json: "json",
    formula: "formula",
    location: "location",
    table: "table",
    "list-items": "list-items",
    "block-array": "block-array",
    "datetime-local": "datetime-local",
    "anchor-select": "anchor-select",
    "project-map-slots": "project-map-slots",
    "project-map-select": "project-map-select",
    "project-backlink-relation": "project-backlink-relation"
  })) r.registerEditor(type, { editor });

  const add = (id, definition) => r.register(id, definition);
  const allFormats = formattingRegistry?.all?.().filter(format => format.toolbar !== false).map(format => format.id) || [];

  // ---------- Shared textual content ----------
  add("content.text", {
    label: "Текст", group: "Текст", type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.credit", {
    label: "Автор / источник", group: "Текст", type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.caption", {
    label: "Подпись", group: "Подпись", type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.captionCredit", {
    label: "Источник подписи", group: "Подпись", type: "rich-text", editor: "rich-text", default: ""
  });

  // ---------- Heading / preformatted / formula / anchor ----------
  add("heading.size", {
    label: "Размер заголовка", group: "Заголовок", type: "integer", editor: "number", min: 1, max: 6, default: 2
  });
  add("preformatted.language", {
    label: "Язык программирования", group: "Код", type: "string", editor: "text", default: ""
  });
  add("math.expression", {
    label: "LaTeX выражение", group: "Формула", type: "string", editor: "formula", default: "x^2"
  });
  add("anchor.name", {
    label: "Имя якоря", group: "Якорь", type: "string", editor: "text", default: "anchor"
  });

  // ---------- Semantic RichText elements exposed as palette blocks ----------
  add("semantic.text", {
    label: "Текст", group: "Содержимое", type: "string", editor: "text", default: ""
  });
  add("semantic.dateTime", {
    label: "Дата и время", group: "Дата / время", type: "string", editor: "datetime-local", default: "", required: true
  });
  add("semantic.dateTimeFormat", {
    label: "Формат", group: "Дата / время", type: "enum", editor: "select", default: "DT",
    options: [
      { value: "r", label: "Относительная дата" },
      { value: "d", label: "Короткая дата" },
      { value: "D", label: "Полная дата" },
      { value: "t", label: "Короткое время" },
      { value: "T", label: "Полное время" },
      { value: "dt", label: "Короткие дата и время" },
      { value: "DT", label: "Полные дата и время" },
      { value: "wDT", label: "День недели, полная дата и время" }
    ]
  });
  add("contact.phone", {
    label: "Телефон", group: "Контакт", type: "string", editor: "text", default: "", required: true
  });
  add("contact.email", {
    label: "E-mail", group: "Контакт", type: "string", editor: "text", default: "", required: true
  });
  add("hashtag.value", {
    label: "Хэштег", group: "Хэштег", type: "string", editor: "text", default: "#", required: true,
    hint: "# добавляется автоматически, если его нет."
  });
  add("link.url", {
    label: "URL", group: "Ссылка", type: "url", editor: "url", default: "", required: true
  });
  add("anchor.target", {
    label: "Якорь", group: "Якорь", type: "string", editor: "anchor-select", default: "",
    hint: "Список строится автоматически из Anchor текущего Rich Message. Пустое значение ведёт в начало сообщения."
  });
  add("button.style", {
    label: "Стиль", group: "Кнопка", type: "enum", editor: "select", default: "",
    options: [
      { value: "", label: "Обычный" },
      { value: "primary", label: "Primary" },
      { value: "success", label: "Success" },
      { value: "danger", label: "Danger" }
    ]
  });

  // ---------- Lists and list items ----------
  // InputRichBlockListItem fields are catalogued independently and reused by the visual collection editor.
  add("list.item.blocks", {
    label: "Блоки элемента", group: "Элемент списка", type: "block-array", editor: "block-array", default: [], telegramField: "blocks",
    hint: "Array<RichBlock>. Для полноценной композиции блоки удобнее собирать на Canvas."
  });
  add("list.item.label", {
    label: "Полученная метка", group: "Элемент списка", type: "string", editor: "text", scope: "received", telegramField: "label",
    readOnly: true
  });
  add("list.item.hasCheckbox", {
    label: "Checkbox", group: "Элемент списка", type: "boolean", editor: "checkbox", default: false,
    telegramField: "has_checkbox"
  });
  add("list.item.isChecked", {
    label: "Отмечен", group: "Элемент списка", type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_checked"
  });
  add("list.item.value", {
    label: "Числовое значение", group: "Элемент списка", type: "integer", editor: "number",
    telegramField: "value"
  });
  add("list.item.type", {
    label: "Тип маркера", group: "Элемент списка", type: "enum", editor: "select",
    values: [{value:"",label:"Нет"}, "1", "a", "A", "i", "I"], default: "", telegramField: "type"
  });
  add("list.items", {
    label: "Элементы списка", group: "Список", type: "list-items", editor: "list-items", default: [],
    telegramField: "items",
    item: {
      label: "Элемент",
      fields: [
        { property: "list.item.blocks", key: "blocks" },
        { property: "list.item.hasCheckbox", key: "has_checkbox" },
        { property: "list.item.isChecked", key: "is_checked" },
        { property: "list.item.value", key: "value" },
        { property: "list.item.type", key: "type" }
      ]
    }
  });

  // Legacy/editor convenience. It is intentionally separate from the Telegram wire model.
  add("list.ordered", {
    label: "Нумерованный список (legacy)", group: "Legacy", type: "boolean", editor: "checkbox", default: false,
    scope: "editor", deprecated: true, groupCollapsed: true
  });

  // ---------- Table and cells ----------
  add("table.cell.text", {
    label: "Текст ячейки", group: "Ячейка таблицы", type: "rich-text", editor: "rich-text", default: "", telegramField: "text",
    formats: allFormats
  });
  add("table.cell.isHeader", {
    label: "Заголовочная ячейка", group: "Ячейка таблицы", type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_header"
  });
  add("table.cell.colspan", {
    label: "Colspan", group: "Ячейка таблицы", type: "integer", editor: "number", min: 1, default: 1,
    telegramField: "colspan"
  });
  add("table.cell.rowspan", {
    label: "Rowspan", group: "Ячейка таблицы", type: "integer", editor: "number", min: 1, default: 1,
    telegramField: "rowspan"
  });
  add("table.cell.align", {
    label: "Горизонтальное выравнивание", group: "Ячейка таблицы", type: "enum", editor: "select",
    values: ["left", "center", "right"], default: "center", telegramField: "align"
  });
  add("table.cell.valign", {
    label: "Вертикальное выравнивание", group: "Ячейка таблицы", type: "enum", editor: "select",
    values: ["top", "middle", "bottom"], default: "middle", telegramField: "valign"
  });
  add("table.cells", {
    label: "Ячейки", group: "Таблица", type: "table", editor: "table", default: [], telegramField: "cells",
    cell: {
      fields: [
        { property: "table.cell.text", key: "text" },
        { property: "table.cell.isHeader", key: "is_header" },
        { property: "table.cell.colspan", key: "colspan" },
        { property: "table.cell.rowspan", key: "rowspan" },
        { property: "table.cell.align", key: "align" },
        { property: "table.cell.valign", key: "valign" }
      ]
    }
  });
  add("table.isBordered", {
    label: "Границы", group: "Таблица", type: "boolean", editor: "checkbox", default: true,
    telegramField: "is_bordered"
  });
  add("table.isStriped", {
    label: "Чередование строк", group: "Таблица", type: "boolean", editor: "checkbox", default: true,
    telegramField: "is_striped"
  });
  add("table.isCompact", {
    label: "Компактная таблица", group: "Таблица", type: "boolean", editor: "checkbox", default: false,
    hint: "Уменьшает внутренние отступы ячеек в Telegram", telegramField: "is_compact"
  });
  add("table.columns", {
    label: "Колонки в редакторе (legacy)", group: "Legacy", type: "integer", editor: "number", min: 1, max: 20, default: 2,
    scope: "editor", deprecated: true, groupCollapsed: true
  });

  // ---------- Details ----------
  add("details.summary", {
    label: "Заголовок", group: "Details", type: "rich-text", editor: "rich-text", default: "Details",
    telegramField: "summary"
  });
  add("details.isOpen", {
    label: "Открыт по умолчанию", group: "Details", type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_open"
  });

  // ---------- Map ----------
  add("map.location", {
    label: "Location", group: "Карта", type: "location", editor: "location", default: { latitude: 0, longitude: 0 },
    telegramField: "location"
  });
  add("map.latitude", {
    label: "Широта (legacy)", group: "Legacy", type: "number", editor: "number", min: -90, max: 90, default: 0,
    scope: "editor", deprecated: true, groupCollapsed: true
  });
  add("map.longitude", {
    label: "Долгота (legacy)", group: "Legacy", type: "number", editor: "number", min: -180, max: 180, default: 0,
    scope: "editor", deprecated: true, groupCollapsed: true
  });
  add("map.zoom", {
    label: "Zoom", group: "Карта", type: "integer", editor: "number", min: 0, max: 24, default: 12
  });
  add("map.width", {
    label: "Ширина", group: "Карта", type: "integer", editor: "number", min: 0, max: 10000, default: 640
  });
  add("map.height", {
    label: "Высота", group: "Карта", type: "integer", editor: "number", min: 0, max: 10000, default: 360
  });

  // ---------- Media ----------
  add("media.source", {
    label: "Media / file_id / URL", group: "Ресурс", type: "media", editor: "media", default: "", scope: "editor", groupCollapsed: true
  });
  add("media.galleryId", {
    label: "Gallery ID", group: "Ресурс", type: "string", editor: "text", default: "", readOnly: true, scope: "editor", groupCollapsed: true,
    hint: "Стабильная ссылка на ресурс в локальном каталоге Gallery."
  });
  add("media.fileId", {
    label: "Telegram file_id", group: "Ресурс", type: "string", editor: "textarea", default: "", readOnly: true, required: true, groupCollapsed: true,
    hint: "Подтягивается из Gallery и используется при preview/publish."
  });
  // Legacy semantic media fields remain registered for compatibility with old Meta Blocks/extensions.
  add("media.animation", { label: "Animation", group: "Ресурс", type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "animation" });
  add("media.audio", { label: "Audio", group: "Ресурс", type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "audio" });
  add("media.photo", { label: "Photo", group: "Ресурс", type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "photo" });
  add("media.video", { label: "Video", group: "Ресурс", type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "video" });
  add("media.voiceNote", { label: "Voice note", group: "Ресурс", type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "voice_note" });
  add("media.hasSpoiler", {
    label: "Спойлер", group: "Медиа", type: "boolean", editor: "checkbox", default: false,
    telegramField: "has_spoiler"
  });
  add("collage.columns", {
    label: "Колонки предпросмотра (legacy)", group: "Legacy", type: "integer", editor: "number", min: 1, max: 6, default: 2,
    scope: "editor", deprecated: true
  });
  add("slideshow.autoplay", {
    label: "Autoplay предпросмотра (legacy)", group: "Legacy", type: "boolean", editor: "checkbox", default: false,
    scope: "editor", deprecated: true
  });

  // ---------- Project virtual blocks ----------
  add("project.map.id", {
    label: "Map ID", group: "Project Map", type: "string", editor: "text", default: "", readOnly: true, scope: "project",
    generateIdPrefix: "map", hint: "Стабильная внутренняя идентичность Map. Telegram URL здесь не хранится."
  });
  add("project.map.slots", {
    label: "Слоты", group: "Project Map", type: "project-map-slots", editor: "project-map-slots", default: [], scope: "project",
    hint: "Каждый слот создаёт один пост проекта. Порядок постов меняется стрелками в этой карте."
  });
  add("project.map.numbering", {
    label: "Нумерация", group: "Project Map", type: "enum", editor: "select", default: "numeric", scope: "project",
    options: [
      { value: "numeric", label: "1, 2, 3…" },
      { value: "latin_upper", label: "A, B, C…" },
      { value: "roman_upper", label: "I, II, III…" },
      { value: "none", label: "Без номера" }
    ]
  });
  add("project.map.emptyText", {
    label: "Текст пустой карты", group: "Project Map", type: "string", editor: "text", default: "Карта пока пуста", scope: "project"
  });
  add("project.backlink.targetMap", {
    label: "Целевая Map", group: "Back to Map", type: "project-map-select", editor: "project-map-select", default: "", scope: "project", required: true
  });
  add("project.backlink.relation", {
    label: "Связь", group: "Back to Map", type: "project-backlink-relation", editor: "project-backlink-relation", default: "", scope: "project", required: true,
    hint: "Связь создаётся вместе с постом и всегда ведёт к карте стартового поста проекта."
  });
  add("project.backlink.text", {
    label: "Текст", group: "Back to Map", type: "string", editor: "text", default: "Назад", scope: "project"
  });

  // ---------- System ----------
  add("thinking.text", {
    label: "Thinking text", group: "System", type: "rich-text", editor: "rich-text", default: "Thinking…"
  });

  // Mirror every RichText operation into the master catalog. Parameterized
  // formatting commands reference registry properties too, so no metadata field
  // schema remains hard-coded in BlockInspector.
  for (const format of formattingRegistry?.all?.() || []) {
    const fieldBindings = [];
    for (const field of format.fields || []) {
      const fieldProperty = `format.${format.id}.${field.key}`;
      add(fieldProperty, {
        kind: "format-metadata",
        label: field.label || field.key,
        group: `Форматирование / ${format.label || format.id}`,
        type: formatFieldType(field.editor),
        editor: normalizeFormatEditor(field.editor),
        required: !!field.required,
        scope: "rich-text-metadata"
      });
      fieldBindings.push({ property: fieldProperty, key: field.key, required: !!field.required });
    }

    add(`format.${format.id}`, {
      kind: "formatting",
      label: format.label || format.id,
      group: "Форматирование текста",
      type: "format-command",
      editor: "format-command",
      formatId: format.id,
      telegramType: format.telegramType || format.id,
      fields: fieldBindings,
      scope: "rich-text"
    });
  }

  return r;
}

function formatFieldType(editor) {
  if (editor === "integer") return "integer";
  if (editor === "json") return "json";
  if (editor === "url") return "url";
  return "string";
}

function normalizeFormatEditor(editor) {
  if (editor === "integer") return "number";
  return editor || "text";
}
