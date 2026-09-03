import { t } from "../i18n/index.js?v=1.8.2";
export class PropertyRegistry {
  constructor(formattingRegistry = null) {
    this.properties = new Map();
    this.editors = new Map();
    this.formatting = formattingRegistry;
  }

  register(id, definition = {}) {
    if (!id) throw new Error("Property definition requires id");
    const item = { id, kind: "property", label: id, group: t("core.propertyRegistry.general"), type: "string", editor: "text", ...structuredClone(definition) };
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
    label: t("core.propertyRegistry.text"), group: t("core.propertyRegistry.text"), type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.credit", {
    label: t("core.propertyRegistry.authorSource"), group: t("core.propertyRegistry.text"), type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.caption", {
    label: t("core.propertyRegistry.caption"), group: t("core.propertyRegistry.caption"), type: "rich-text", editor: "rich-text", default: ""
  });
  add("content.captionCredit", {
    label: t("core.propertyRegistry.captionSource"), group: t("core.propertyRegistry.caption"), type: "rich-text", editor: "rich-text", default: ""
  });

  // ---------- Heading / preformatted / formula / anchor ----------
  add("heading.size", {
    label: t("core.propertyRegistry.headerSize"), group: t("core.propertyRegistry.header"), type: "integer", editor: "number", min: 1, max: 6, default: 2
  });
  add("preformatted.language", {
    label: t("core.propertyRegistry.programmingLanguage"), group: t("core.propertyRegistry.code"), type: "string", editor: "text", default: ""
  });
  add("math.expression", {
    label: t("core.propertyRegistry.latexExpression"), group: t("core.propertyRegistry.formula"), type: "string", editor: "formula", default: "x^2"
  });
  add("anchor.name", {
    label: t("core.formattingRegistry.anchorName"), group: t("core.formattingRegistry.anchor"), type: "string", editor: "text", default: "anchor"
  });

  // ---------- Semantic RichText elements exposed as palette blocks ----------
  add("semantic.text", {
    label: t("core.propertyRegistry.text"), group: t("core.propertyRegistry.content"), type: "string", editor: "text", default: ""
  });
  add("semantic.dateTime", {
    label: t("core.propertyRegistry.dateAndTime"), group: t("core.formattingRegistry.dateTime"), type: "string", editor: "datetime-local", default: "", required: true
  });
  add("semantic.dateTimeFormat", {
    label: t("core.propertyRegistry.format"), group: t("core.formattingRegistry.dateTime"), type: "enum", editor: "select", default: "DT",
    options: [
      { value: "r", label: t("core.propertyRegistry.relativeDate") },
      { value: "d", label: t("core.propertyRegistry.shortDate") },
      { value: "D", label: t("core.propertyRegistry.fullDate") },
      { value: "t", label: t("core.propertyRegistry.shortTime") },
      { value: "T", label: t("core.propertyRegistry.fullTime") },
      { value: "dt", label: t("core.propertyRegistry.shortDateAndTime") },
      { value: "DT", label: t("core.propertyRegistry.fullDateAndTime") },
      { value: "wDT", label: t("core.propertyRegistry.dayOfTheWeekFullDateAnd") }
    ]
  });
  add("contact.phone", {
    label: t("core.formattingRegistry.phone"), group: t("core.propertyRegistry.contact"), type: "string", editor: "text", default: "", required: true
  });
  add("contact.email", {
    label: t("core.propertyRegistry.email"), group: t("core.propertyRegistry.contact"), type: "string", editor: "text", default: "", required: true
  });
  add("hashtag.value", {
    label: t("core.formattingRegistry.hashtag"), group: t("core.formattingRegistry.hashtag"), type: "string", editor: "text", default: "#", required: true,
    hint: t("core.propertyRegistry.isAddedAutomaticallyIfItIsNot")
  });
  add("link.url", {
    label: t("core.propertyRegistry.url"), group: t("core.formattingRegistry.link"), type: "url", editor: "url", default: "", required: true
  });
  add("anchor.target", {
    label: t("core.formattingRegistry.anchor"), group: t("core.formattingRegistry.anchor"), type: "string", editor: "anchor-select", default: "",
    hint: t("core.propertyRegistry.theListIsBuiltAutomaticallyFromThe")
  });
  add("button.style", {
    label: t("core.propertyRegistry.style"), group: t("core.propertyRegistry.button"), type: "enum", editor: "select", default: "",
    options: [
      { value: "", label: t("core.propertyRegistry.normal") },
      { value: "primary", label: t("core.propertyRegistry.primary") },
      { value: "success", label: t("core.propertyRegistry.success") },
      { value: "danger", label: t("core.propertyRegistry.danger") }
    ]
  });
  add("button.align", {
    label: t("core.propertyRegistry.horizontalAlignment"), group: t("core.propertyRegistry.button"), type: "enum", editor: "select", default: "",
    options: [
      { value: "", label: t("core.propertyRegistry.normal") },
      { value: "left", label: t("editor.blockInspector.left") },
      { value: "center", label: t("editor.blockInspector.center") },
      { value: "right", label: t("editor.blockInspector.right") }
    ]
  });

  // ---------- Lists and list items ----------
  // InputRichBlockListItem fields are catalogued independently and reused by the visual collection editor.
  add("list.item.blocks", {
    label: t("core.propertyRegistry.elementBlocks"), group: t("core.propertyRegistry.listItem"), type: "block-array", editor: "block-array", default: [], telegramField: "blocks",
    hint: t("core.propertyRegistry.arrayForFullCompositionBlocksAreMore")
  });
  add("list.item.label", {
    label: t("core.propertyRegistry.obtainedLabel"), group: t("core.propertyRegistry.listItem"), type: "string", editor: "text", scope: "received", telegramField: "label",
    readOnly: true
  });
  add("list.item.hasCheckbox", {
    label: t("core.propertyRegistry.checkbox"), group: t("core.propertyRegistry.listItem"), type: "boolean", editor: "checkbox", default: false,
    telegramField: "has_checkbox"
  });
  add("list.item.isChecked", {
    label: t("core.propertyRegistry.checked"), group: t("core.propertyRegistry.listItem"), type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_checked"
  });
  add("list.item.value", {
    label: t("core.propertyRegistry.numericValue"), group: t("core.propertyRegistry.listItem"), type: "integer", editor: "number",
    telegramField: "value"
  });
  add("list.item.type", {
    label: t("core.propertyRegistry.markerType"), group: t("core.propertyRegistry.listItem"), type: "enum", editor: "select",
    values: [{value:"",label:t("core.propertyRegistry.none")}, "1", "a", "A", "i", "I"], default: "", telegramField: "type"
  });
  add("list.items", {
    label: t("core.propertyRegistry.listItems"), group: t("core.propertyRegistry.list"), type: "list-items", editor: "list-items", default: [],
    telegramField: "items",
    item: {
      label: t("core.propertyRegistry.item"),
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
    label: t("core.propertyRegistry.numberedListLegacy"), group: t("core.propertyRegistry.legacy"), type: "boolean", editor: "checkbox", default: false,
    scope: "editor", deprecated: true, groupCollapsed: true
  });

  // ---------- Table and cells ----------
  add("table.cell.text", {
    label: t("core.propertyRegistry.cellText"), group: t("core.propertyRegistry.tableCell"), type: "rich-text", editor: "rich-text", default: "", telegramField: "text",
    formats: allFormats
  });
  add("table.cell.isHeader", {
    label: t("core.propertyRegistry.headerCell"), group: t("core.propertyRegistry.tableCell"), type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_header"
  });
  add("table.cell.colspan", {
    label: t("core.propertyRegistry.colspan"), group: t("core.propertyRegistry.tableCell"), type: "integer", editor: "number", min: 1, default: 1,
    telegramField: "colspan"
  });
  add("table.cell.rowspan", {
    label: t("core.propertyRegistry.rowspan"), group: t("core.propertyRegistry.tableCell"), type: "integer", editor: "number", min: 1, default: 1,
    telegramField: "rowspan"
  });
  add("table.cell.align", {
    label: t("core.propertyRegistry.horizontalAlignment"), group: t("core.propertyRegistry.tableCell"), type: "enum", editor: "select",
    values: ["left", "center", "right"], default: "center", telegramField: "align"
  });
  add("table.cell.valign", {
    label: t("core.propertyRegistry.verticalAlignment"), group: t("core.propertyRegistry.tableCell"), type: "enum", editor: "select",
    values: ["top", "middle", "bottom"], default: "middle", telegramField: "valign"
  });
  add("table.cells", {
    label: t("core.propertyRegistry.cells"), group: t("core.propertyRegistry.table"), type: "table", editor: "table", default: [], telegramField: "cells",
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
    label: t("core.propertyRegistry.borders"), group: t("core.propertyRegistry.table"), type: "boolean", editor: "checkbox", default: true,
    telegramField: "is_bordered"
  });
  add("table.isStriped", {
    label: t("core.propertyRegistry.rowStriping"), group: t("core.propertyRegistry.table"), type: "boolean", editor: "checkbox", default: true,
    telegramField: "is_striped"
  });
  add("table.isCompact", {
    label: t("core.propertyRegistry.compactTable"), group: t("core.propertyRegistry.table"), type: "boolean", editor: "checkbox", default: false,
    hint: t("core.propertyRegistry.reducesCellPaddingInTelegram"), telegramField: "is_compact"
  });
  add("table.columns", {
    label: t("core.propertyRegistry.columnsInEditorLegacy"), group: t("core.propertyRegistry.legacy"), type: "integer", editor: "number", min: 1, max: 20, default: 2,
    scope: "editor", deprecated: true, groupCollapsed: true
  });

  // ---------- Details ----------
  add("details.summary", {
    label: t("core.propertyRegistry.header"), group: t("core.propertyRegistry.details"), type: "rich-text", editor: "rich-text", default: t("blocks.registerCoreBlocks.details"),
    telegramField: "summary"
  });
  add("details.isOpen", {
    label: t("core.propertyRegistry.openByDefault"), group: t("core.propertyRegistry.details"), type: "boolean", editor: "checkbox", default: false,
    telegramField: "is_open"
  });

  // ---------- Map ----------
  add("map.location", {
    label: t("core.propertyRegistry.location"), group: t("core.propertyRegistry.map"), type: "location", editor: "location", default: { latitude: 0, longitude: 0 },
    telegramField: "location"
  });
  add("map.latitude", {
    label: t("core.propertyRegistry.latitudeLegacy"), group: t("core.propertyRegistry.legacy"), type: "number", editor: "number", min: -90, max: 90, default: 0,
    scope: "editor", deprecated: true, groupCollapsed: true
  });
  add("map.longitude", {
    label: t("core.propertyRegistry.longitudeLegacy"), group: t("core.propertyRegistry.legacy"), type: "number", editor: "number", min: -180, max: 180, default: 0,
    scope: "editor", deprecated: true, groupCollapsed: true
  });
  add("map.zoom", {
    label: t("core.propertyRegistry.zoom"), group: t("core.propertyRegistry.map"), type: "integer", editor: "number", min: 0, max: 24, default: 12
  });
  add("map.width", {
    label: t("core.propertyRegistry.width"), group: t("core.propertyRegistry.map"), type: "integer", editor: "number", min: 0, max: 10000, default: 640
  });
  add("map.height", {
    label: t("core.propertyRegistry.height"), group: t("core.propertyRegistry.map"), type: "integer", editor: "number", min: 0, max: 10000, default: 360
  });

  // ---------- Media ----------
  add("media.source", {
    label: t("core.propertyRegistry.mediaSource"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", scope: "editor", groupCollapsed: true
  });
  add("media.galleryId", {
    label: t("core.propertyRegistry.galleryId"), group: t("app.appNotifications.resource"), type: "string", editor: "text", default: "", readOnly: true, scope: "editor", groupCollapsed: true,
    hint: t("core.propertyRegistry.permanentLinkToResourceInLocalGallery")
  });
  add("media.fileId", {
    label: t("core.propertyRegistry.telegramFileId"), group: t("app.appNotifications.resource"), type: "string", editor: "textarea", default: "", readOnly: true, required: true, groupCollapsed: true,
    hint: t("core.propertyRegistry.fetchedFromGalleryAndUsedInPreview")
  });
  // Legacy semantic media fields remain registered for compatibility with old Meta Blocks/extensions.
  add("media.animation", { label: t("blocks.registerCoreBlocks.animation"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "animation" });
  add("media.audio", { label: t("blocks.registerCoreBlocks.audio"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "audio" });
  add("media.photo", { label: t("blocks.registerCoreBlocks.photo"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "photo" });
  add("media.video", { label: t("blocks.registerCoreBlocks.video"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "video" });
  add("media.voiceNote", { label: t("blocks.registerCoreBlocks.voiceNote"), group: t("app.appNotifications.resource"), type: "media", editor: "media", default: "", groupCollapsed: true, telegramField: "voice_note" });
  add("media.hasSpoiler", {
    label: t("core.formattingRegistry.spoiler"), group: t("core.propertyRegistry.media"), type: "boolean", editor: "checkbox", default: false,
    telegramField: "has_spoiler"
  });
  add("collage.columns", {
    label: t("core.propertyRegistry.previewColumnsLegacy"), group: t("core.propertyRegistry.legacy"), type: "integer", editor: "number", min: 1, max: 6, default: 2,
    scope: "editor", deprecated: true
  });
  add("slideshow.autoplay", {
    label: t("core.propertyRegistry.previewAutoplayLegacy"), group: t("core.propertyRegistry.legacy"), type: "boolean", editor: "checkbox", default: false,
    scope: "editor", deprecated: true
  });

  // ---------- Project virtual blocks ----------
  add("project.map.id", {
    label: t("core.propertyRegistry.mapId"), group: t("core.propertyRegistry.projectMap"), type: "string", editor: "text", default: "", readOnly: true, scope: "project",
    generateIdPrefix: "map", hint: t("core.propertyRegistry.stableInternalIdentityOfMapTelegramURL")
  });
  add("project.map.slots", {
    label: t("core.propertyRegistry.slots"), group: t("core.propertyRegistry.projectMap"), type: "project-map-slots", editor: "project-map-slots", default: [], scope: "project",
    hint: t("core.propertyRegistry.eachSlotCreatesOneProjectPostPost")
  });
  add("project.map.numbering", {
    label: t("core.propertyRegistry.numbering"), group: t("core.propertyRegistry.projectMap"), type: "enum", editor: "select", default: "numeric", scope: "project",
    options: [
      { value: "numeric", label: "1, 2, 3…" },
      { value: "latin_upper", label: "A, B, C…" },
      { value: "roman_upper", label: "I, II, III…" },
      { value: "none", label: t("core.propertyRegistry.noNumber") }
    ]
  });
  add("project.map.emptyText", {
    label: t("core.propertyRegistry.emptyMapText"), group: t("core.propertyRegistry.projectMap"), type: "string", editor: "text", default: t("core.propertyRegistry.mapIsCurrentlyEmpty"), scope: "project"
  });
  add("project.backlink.targetMap", {
    label: t("core.propertyRegistry.targetMap"), group: t("core.propertyRegistry.backToMap"), type: "project-map-select", editor: "project-map-select", default: "", scope: "project", required: true
  });
  add("project.backlink.relation", {
    label: t("core.propertyRegistry.link"), group: t("core.propertyRegistry.backToMap"), type: "project-backlink-relation", editor: "project-backlink-relation", default: "", scope: "project", required: true,
    hint: t("core.propertyRegistry.linkIsCreatedTogetherWithThePost")
  });
  add("project.backlink.text", {
    label: t("core.propertyRegistry.text"), group: t("core.propertyRegistry.backToMap"), type: "string", editor: "text", default: t("core.propertyRegistry.back"), scope: "project"
  });

  // ---------- System ----------
  add("thinking.text", {
    label: t("core.propertyRegistry.thinkingText"), group: t("core.propertyRegistry.system"), type: "rich-text", editor: "rich-text", default: t("blocks.registerCoreBlocks.thinkingDefault")
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
        group: t("core.propertyRegistry.formatting", { 0: format.label || format.id }),
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
      group: t("core.propertyRegistry.textFormatting"),
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
