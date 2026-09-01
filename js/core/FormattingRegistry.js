import { t } from "../i18n/index.js?v=1.8.0";
export class FormattingRegistry {
  constructor() {
    this.formats = new Map();
  }

  register(id, definition = {}) {
    if (!id) throw new Error("Formatting definition requires id");
    const item = { id, telegramType: definition.telegramType || id, toolbar: definition.toolbar !== false, ...structuredClone(definition) };
    this.formats.set(id, item);
    return item;
  }

  get(id) { return this.formats.get(id); }
  has(id) { return this.formats.has(id); }
  all() { return [...this.formats.values()]; }
}

const field = (key, label, editor = "text", extra = {}) => ({ key, label, editor, ...extra });

export function createTelegramFormattingRegistry() {
  const r = new FormattingRegistry();

  const wrapper = (id, label, shortLabel, extra = {}) =>
    r.register(id, { label, shortLabel, wrapperField: "text", ...extra });
  const semanticWrapper = (id, label, shortLabel, extra = {}) =>
    wrapper(id, label, shortLabel, { toolbar: false, semantic: true, ...extra });

  // Toolbar = visual formatting plus the date/time wrapper. Other parameterized
  // semantic entities stay in the registry for wire compatibility and are exposed
  // as dedicated palette elements.
  wrapper("bold", t("core.formattingRegistry.bold"), "B");
  wrapper("italic", t("core.formattingRegistry.italic"), "I");
  wrapper("underline", t("core.formattingRegistry.underline"), "U");
  wrapper("strikethrough", t("core.formattingRegistry.strikethrough"), "S");
  wrapper("spoiler", t("core.formattingRegistry.spoiler"), "◫");
  wrapper("subscript", t("core.formattingRegistry.subscript"), "x₂");
  wrapper("superscript", t("core.formattingRegistry.superscript"), "x²");
  wrapper("marked", t("core.formattingRegistry.highlight"), "▣");
  wrapper("code", t("core.formattingRegistry.monospaceCode"), "</>");

  semanticWrapper("date_time", t("core.formattingRegistry.dateTime"), "🕒", {
    toolbar: true,
    metadataEditor: "date-time",
    inheritMetadata: true,
    replaceExisting: true,
    fields: [
      field("unix_time", t("core.formattingRegistry.unixTime"), "integer", { required: true }),
      field("date_time_format", t("core.formattingRegistry.dateTimeFormat"), "text", { required: true })
    ]
  });
  semanticWrapper("text_mention", t("core.formattingRegistry.userMention"), "@id", {
    fields: [field("user", t("core.formattingRegistry.userJson"), "json", { required: true })]
  });
  semanticWrapper("url", t("core.formattingRegistry.link"), "🔗", {
    fields: [field("url", "URL", "url", { required: true })]
  });
  semanticWrapper("email_address", "E-mail", "✉", {
    fields: [field("email_address", "E-mail", "text", { required: true })]
  });
  semanticWrapper("phone_number", t("core.formattingRegistry.phone"), "☎", {
    fields: [field("phone_number", t("core.formattingRegistry.phone"), "text", { required: true })]
  });
  semanticWrapper("bank_card_number", t("core.formattingRegistry.cardNumber"), "▰", {
    fields: [field("bank_card_number", t("core.formattingRegistry.cardNumber"), "text", { required: true })]
  });
  semanticWrapper("mention", t("core.formattingRegistry.mentionUsername"), "@", {
    fields: [field("username", "Username", "text", { required: true })]
  });
  semanticWrapper("hashtag", t("core.formattingRegistry.hashtag"), "#", {
    fields: [field("hashtag", "Hashtag", "text", { required: true })]
  });
  semanticWrapper("cashtag", "Cashtag", "$", {
    fields: [field("cashtag", "Cashtag", "text", { required: true })]
  });
  semanticWrapper("bot_command", t("core.formattingRegistry.botCommand"), "/", {
    fields: [field("bot_command", t("core.formattingRegistry.command"), "text", { required: true })]
  });
  semanticWrapper("anchor_link", t("blocks.registerCoreBlocks.anchorLink"), "⚓→", {
    fields: [field("anchor_name", t("core.formattingRegistry.anchorName"), "text")]
  });
  semanticWrapper("reference", t("core.formattingRegistry.sourceLink"), "[ ]", {
    fields: [field("name", t("core.formattingRegistry.linkName"), "text", { required: true })]
  });
  semanticWrapper("reference_link", t("core.formattingRegistry.goToSourceLink"), "↗ref", {
    fields: [field("reference_name", t("core.formattingRegistry.linkName"), "text", { required: true })]
  });

  r.register("mathematical_expression", {
    label: t("core.formattingRegistry.mathematicalExpression"),
    shortLabel: "∑",
    toolbar: false,
    semantic: true,
    fields: [field("expression", "LaTeX", "text", { required: true })]
  });
  r.register("anchor", {
    label: t("core.formattingRegistry.anchor"),
    shortLabel: "⚓",
    toolbar: false,
    semantic: true,
    fields: [field("name", t("core.formattingRegistry.anchorName"), "text", { required: true })]
  });

  return r;
}

export const FORMAT_GROUPS = Object.freeze({
  basic: ["bold", "italic", "underline", "strikethrough", "spoiler", "marked"],
  heading: ["bold", "italic", "underline", "strikethrough", "marked"],
  code: ["code"],
  full: [
    "bold", "italic", "underline", "strikethrough", "spoiler",
    "subscript", "superscript", "marked", "code", "date_time"
  ]
});
