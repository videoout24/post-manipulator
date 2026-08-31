export function richTextToPlain(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(richTextToPlain).join("");
  if (typeof value !== "object") return String(value);
  if ("text" in value) return richTextToPlain(value.text);
  if (value.type === "custom_emoji") return value.alternative_text || "";
  if (value.type === "mathematical_expression") return value.expression || "";
  if (value.type === "anchor") return "";
  return "";
}

export function richTextLength(value) {
  return richTextToPlain(value).length;
}

export function compactRichText(value) {
  if (!Array.isArray(value)) return value;
  const out = [];
  for (const item of value.flatMap(v => Array.isArray(v) ? v : [v])) {
    if (item == null || item === "") continue;
    if (typeof item === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += item;
    else out.push(item);
  }
  if (out.length === 0) return "";
  if (out.length === 1) return out[0];
  return out;
}

export function sliceRichText(value, start, end) {
  const total = richTextLength(value);
  const from = Math.max(0, Math.min(start, total));
  const to = Math.max(from, Math.min(end, total));
  return compactRichText(sliceNode(value, from, to));
}

export function insertRichText(value, position, inserted) {
  const total = richTextLength(value);
  const at = Math.max(0, Math.min(Number(position) || 0, total));
  return compactRichText([
    sliceRichText(value, 0, at),
    structuredClone(inserted),
    sliceRichText(value, at, total)
  ]);
}

export function replaceRichTextRange(value, start, end, replacement = "") {
  const total = richTextLength(value);
  const from = Math.max(0, Math.min(Number(start) || 0, total));
  const to = Math.max(from, Math.min(Number(end) || 0, total));
  return compactRichText([
    sliceRichText(value, 0, from),
    replacement,
    sliceRichText(value, to, total)
  ]);
}

function sliceNode(value, start, end) {
  if (end <= start) return "";
  if (typeof value === "string") return value.slice(start, end);
  if (Array.isArray(value)) {
    const pieces = [];
    let cursor = 0;
    for (const child of value) {
      const length = richTextLength(child);
      const localStart = Math.max(0, start - cursor);
      const localEnd = Math.min(length, end - cursor);
      if (localEnd > localStart) pieces.push(sliceNode(child, localStart, localEnd));
      cursor += length;
      if (cursor >= end) break;
    }
    return compactRichText(pieces);
  }
  if (!value || typeof value !== "object") return "";

  if ("text" in value) {
    const cloned = structuredClone(value);
    cloned.text = sliceNode(value.text, start, end);
    return richTextLength(cloned.text) ? cloned : "";
  }

  const len = richTextLength(value);
  if (start === 0 && end >= len) return structuredClone(value);
  return richTextToPlain(value).slice(start, end);
}


export function richTextRangeHasFormat(value, start, end, formatDefinition) {
  const type = formatDefinition?.telegramType || formatDefinition?.id || formatDefinition;
  if (!type) return false;
  const total = richTextLength(value);
  const from = Math.max(0, Math.min(Number(start) || 0, total));
  const to = Math.max(from, Math.min(Number(end) || 0, total));
  if (to <= from) return richTextFormatAtPosition(value, from, type);
  const selected = sliceRichText(value, from, to);
  const coverage = formatCoverage(selected, type, false);
  return coverage.total > 0 && coverage.covered === coverage.total;
}

export function richTextFormatAtPosition(value, position, formatDefinition) {
  const type = formatDefinition?.telegramType || formatDefinition?.id || formatDefinition;
  if (!type) return false;
  const total = richTextLength(value);
  if (!total) return false;
  const pos = Math.max(0, Math.min(Number(position) || 0, total));
  // At a caret boundary use the character immediately before the caret, like
  // common rich-text editors. At position 0 inspect the first character.
  const index = pos > 0 ? pos - 1 : 0;
  return formatAtCharacter(value, index, type, false);
}

export function richTextFormatMetadataAtPosition(value, position, formatDefinition) {
  const type = formatDefinition?.telegramType || formatDefinition?.id || formatDefinition;
  if (!type) return null;
  const total = richTextLength(value);
  if (!total) return null;
  const pos = Math.max(0, Math.min(Number(position) || 0, total));
  return formatMetadataAtCharacter(value, pos > 0 ? pos - 1 : 0, type);
}

export function removeRichTextFormat(value, formatDefinition) {
  const type = formatDefinition?.telegramType || formatDefinition?.id || formatDefinition;
  if (!type) return structuredClone(value);
  return compactRichText(removeFormatNode(value, type));
}

export function toggleRichTextFormat(value, start, end, formatDefinition, metadata = {}) {
  const total = richTextLength(value);
  const from = Math.max(0, Math.min(Number(start) || 0, total));
  const to = Math.max(from, Math.min(Number(end) || 0, total));
  if (to <= from) return value;

  const before = sliceRichText(value, 0, from);
  const selected = sliceRichText(value, from, to);
  const after = sliceRichText(value, to, total);
  const fullyApplied = richTextRangeHasFormat(value, from, to, formatDefinition);
  const clean = removeRichTextFormat(selected, formatDefinition);
  const nextSelected = fullyApplied ? clean : buildFormatNode(clean, formatDefinition, metadata);
  return compactRichText([before, nextSelected, after]);
}

export function wrapRichTextWithFormats(value, formatDefinitions = []) {
  let next = structuredClone(value);
  for (const format of formatDefinitions) {
    if (!format?.wrapperField) continue;
    next = buildFormatNode(next, format, {});
  }
  return next;
}

function formatCoverage(value, type, inherited) {
  if (value == null) return { total: 0, covered: 0 };
  if (typeof value === "string" || typeof value === "number") {
    const total = String(value).length;
    return { total, covered: inherited ? total : 0 };
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, child) => {
      const part = formatCoverage(child, type, inherited);
      sum.total += part.total;
      sum.covered += part.covered;
      return sum;
    }, { total: 0, covered: 0 });
  }
  if (typeof value !== "object") return { total: 0, covered: 0 };
  const active = inherited || value.type === type;
  if ("text" in value) return formatCoverage(value.text, type, active);
  const total = richTextLength(value);
  return { total, covered: active ? total : 0 };
}

function formatAtCharacter(value, index, type, inherited) {
  if (value == null) return false;
  if (typeof value === "string" || typeof value === "number") {
    return index >= 0 && index < String(value).length ? inherited : false;
  }
  if (Array.isArray(value)) {
    let cursor = 0;
    for (const child of value) {
      const length = richTextLength(child);
      if (index < cursor + length) return formatAtCharacter(child, index - cursor, type, inherited);
      cursor += length;
    }
    return false;
  }
  if (typeof value !== "object") return false;
  const active = inherited || value.type === type;
  if ("text" in value) return formatAtCharacter(value.text, index, type, active);
  return index >= 0 && index < richTextLength(value) ? active : false;
}

function formatMetadataAtCharacter(value, index, type) {
  if (value == null || typeof value === "string" || typeof value === "number") return null;
  if (Array.isArray(value)) {
    let cursor = 0;
    for (const child of value) {
      const length = richTextLength(child);
      if (index < cursor + length) return formatMetadataAtCharacter(child, index - cursor, type);
      cursor += length;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (value.type === type) {
    const { type: ignored, text: ignoredText, ...metadata } = value;
    return structuredClone(metadata);
  }
  return "text" in value ? formatMetadataAtCharacter(value.text, index, type) : null;
}

function removeFormatNode(value, type) {
  if (value == null || typeof value === "string" || typeof value === "number") return structuredClone(value);
  if (Array.isArray(value)) return compactRichText(value.map(child => removeFormatNode(child, type)));
  if (typeof value !== "object") return value;
  if (value.type === type && "text" in value) return removeFormatNode(value.text, type);
  const clone = structuredClone(value);
  if ("text" in clone) clone.text = removeFormatNode(clone.text, type);
  return clone;
}

export function applyRichTextFormat(value, start, end, formatDefinition, metadata = {}) {
  const plain = richTextToPlain(value);
  const from = Math.max(0, Math.min(start, plain.length));
  const to = Math.max(from, Math.min(end, plain.length));
  if (to <= from) return value;

  const before = sliceRichText(value, 0, from);
  const selected = sliceRichText(value, from, to);
  const after = sliceRichText(value, to, plain.length);
  const formatted = buildFormatNode(selected, formatDefinition, metadata);
  return compactRichText([before, formatted, after]);
}

function buildFormatNode(selected, formatDefinition, metadata) {
  const node = { type: formatDefinition.telegramType || formatDefinition.id, ...structuredClone(metadata) };
  if (formatDefinition.wrapperField) {
    node[formatDefinition.wrapperField] = selected;
    return node;
  }

  const text = richTextToPlain(selected);
  if (node.type === "custom_emoji" && !node.alternative_text) node.alternative_text = text;
  if (node.type === "mathematical_expression" && !node.expression) node.expression = text;
  if (node.type === "anchor") return node;
  return node;
}
