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
  wrapper("bold", "Жирный", "B");
  wrapper("italic", "Курсив", "I");
  wrapper("underline", "Подчёркивание", "U");
  wrapper("strikethrough", "Зачёркивание", "S");
  wrapper("spoiler", "Спойлер", "◫");
  wrapper("subscript", "Нижний индекс", "x₂");
  wrapper("superscript", "Верхний индекс", "x²");
  wrapper("marked", "Выделение", "▣");
  wrapper("code", "Моноширинный код", "</>");

  semanticWrapper("date_time", "Дата / время", "🕒", {
    toolbar: true,
    metadataEditor: "date-time",
    inheritMetadata: true,
    replaceExisting: true,
    fields: [
      field("unix_time", "Unix time", "integer", { required: true }),
      field("date_time_format", "Формат даты/времени", "text", { required: true })
    ]
  });
  semanticWrapper("text_mention", "Упоминание пользователя", "@id", {
    fields: [field("user", "User JSON", "json", { required: true })]
  });
  semanticWrapper("url", "Ссылка", "🔗", {
    fields: [field("url", "URL", "url", { required: true })]
  });
  semanticWrapper("email_address", "E-mail", "✉", {
    fields: [field("email_address", "E-mail", "text", { required: true })]
  });
  semanticWrapper("phone_number", "Телефон", "☎", {
    fields: [field("phone_number", "Телефон", "text", { required: true })]
  });
  semanticWrapper("bank_card_number", "Номер карты", "▰", {
    fields: [field("bank_card_number", "Номер карты", "text", { required: true })]
  });
  semanticWrapper("mention", "Упоминание @username", "@", {
    fields: [field("username", "Username", "text", { required: true })]
  });
  semanticWrapper("hashtag", "Хэштег", "#", {
    fields: [field("hashtag", "Hashtag", "text", { required: true })]
  });
  semanticWrapper("cashtag", "Cashtag", "$", {
    fields: [field("cashtag", "Cashtag", "text", { required: true })]
  });
  semanticWrapper("bot_command", "Команда бота", "/", {
    fields: [field("bot_command", "Команда", "text", { required: true })]
  });
  semanticWrapper("anchor_link", "Ссылка на якорь", "⚓→", {
    fields: [field("anchor_name", "Имя якоря", "text")]
  });
  semanticWrapper("reference", "Ссылка-источник", "[ ]", {
    fields: [field("name", "Имя ссылки", "text", { required: true })]
  });
  semanticWrapper("reference_link", "Переход к ссылке-источнику", "↗ref", {
    fields: [field("reference_name", "Имя ссылки", "text", { required: true })]
  });

  r.register("mathematical_expression", {
    label: "Математическое выражение",
    shortLabel: "∑",
    toolbar: false,
    semantic: true,
    fields: [field("expression", "LaTeX", "text", { required: true })]
  });
  r.register("anchor", {
    label: "Якорь",
    shortLabel: "⚓",
    toolbar: false,
    semantic: true,
    fields: [field("name", "Имя якоря", "text", { required: true })]
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
