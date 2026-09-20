export function resolveAiSchemaCatalog(messageAst, registry) {
  const blockSchemas = {};
  const formatSets = {};
  const formatSetIds = new Map();
  const formattingRegistry = registry?.properties?.formatting;
  let usesRichText = false;
  const formats = {
    reference(values = []) {
      usesRichText = true;
      if (!Array.isArray(values) || !values.length) return "";
      const signature = JSON.stringify(values);
      if (!formatSetIds.has(signature)) {
        const id = `f${formatSetIds.size + 1}`;
        formatSetIds.set(signature, id);
        formatSets[id] = describeFormatSet(values, formattingRegistry);
      }
      return formatSetIds.get(signature);
    }
  };
  const seen = new Set();
  walk(messageAst, node => {
    const type = String(node?.type || "").trim();
    if (!type || type === "document" || seen.has(type)) return;
    seen.add(type);
    const definition = registry?.get?.(type);
    if (!definition) return;
    blockSchemas[type] = describeBlock(definition, registry, formats);
  });
  return {
    blockSchemas,
    formatSets,
    richTextSchema: usesRichText
      ? {
          appliesTo: "changed rich-text properties",
          whenFormatNotRequested: "string",
          whenFormatRequested: "one object matching task.formatSets[property.formatSet]",
          maxFormatsPerProperty: 1,
          arraysAllowed: false,
          nestedFormatsAllowed: false,
          unchangedExistingValues: "preserve verbatim"
        }
      : null
  };
}

function describeFormatSet(values = [], formattingRegistry = null) {
  const simpleFormats = [];
  const specialFormats = {};
  for (const id of values) {
    const format = formattingRegistry?.get?.(id) || { id, telegramType: id };
    const type = String(format.telegramType || format.id || id);
    const fields = Array.isArray(format.fields) ? format.fields : [];
    if (!fields.length) {
      simpleFormats.push(type);
      continue;
    }
    specialFormats[id] = {
      type,
      text: "string",
      ...Object.fromEntries(fields.map(field => [field.key, formatFieldType(field.editor)]))
    };
  }
  return {
    ...(simpleFormats.length ? {
      simpleFormats,
      simpleTemplate: { type: "<one simpleFormats value>", text: "string" }
    } : {}),
    ...(Object.keys(specialFormats).length ? { specialFormats } : {})
  };
}

function formatFieldType(editor) {
  if (editor === "integer" || editor === "number" || editor === "boolean" || editor === "json") return editor;
  return "string";
}

function describeBlock(definition, registry, formats) {
  const props = {};
  for (const binding of registry?.propertyBindings?.(definition) || definition?.propertyBindings || []) {
    const key = String(binding?.key || "").trim();
    if (!key) continue;
    props[key] = describeProperty(binding, registry?.properties, formats);
  }
  const children = definition?.children || { allowed: false };
  return {
    props,
    children: children.allowed === true
      ? {
          type: "array",
          items: { type: "block", schemaRef: "task.blockSchemas[item.type]" },
          ...(Array.isArray(children.types) && children.types.length ? { blockTypes: [...children.types] } : {}),
          ...(Number.isFinite(children.minItems) ? { minItems: Number(children.minItems) } : {}),
          ...(Number.isFinite(children.maxItems) ? { maxItems: Number(children.maxItems) } : {})
        }
      : { allowed: false }
  };
}

function describeProperty(schema = {}, propertyRegistry = null, formats = null) {
  const type = String(schema.type || "string");
  let result;
  if (type === "list-items") {
    result = {
      type: "array",
      items: {
        type: "object",
        props: describeNestedFields(schema.item?.fields, propertyRegistry, formats)
      }
    };
  } else if (type === "table") {
    result = {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          props: describeNestedFields(schema.cell?.fields, propertyRegistry, formats)
        }
      }
    };
  } else if (type === "block-array") {
    result = {
      type: "array",
      items: {
        type: "rich-block",
        required: ["type"],
        example: { type: "paragraph", text: "Visible text" }
      }
    };
  } else if (type === "rich-text") {
    const formatSet = formats?.reference?.(schema.formats);
    result = {
      type: "rich-text",
      ...(formatSet ? { formatSet } : {})
    };
  } else if (type === "location") {
    result = {
      type: "object",
      props: {
        latitude: { type: "number", required: true },
        longitude: { type: "number", required: true }
      }
    };
  } else if (type === "project-map-slots") {
    result = {
      type: "array",
      items: {
        type: "object",
        props: {
          id: { type: "string", required: true },
          targetPostId: { type: "string", nullable: true },
          text: { type: "string" },
          derivedFromPostId: { type: "string" }
        }
      }
    };
  } else {
    result = { type: primitiveType(type, schema.default) };
  }

  const values = enumValues(schema);
  if (values.length) result.enum = values;
  if (schema.required === true) result.required = true;
  if (schema.readOnly === true) result.editable = false;
  if (schema.min != null && Number.isFinite(Number(schema.min))) result.min = Number(schema.min);
  if (schema.max != null && Number.isFinite(Number(schema.max))) result.max = Number(schema.max);
  if (schema.default !== undefined && compactDefault(schema.default)) result.default = structuredClone(schema.default);
  return result;
}

function describeNestedFields(fields = [], propertyRegistry = null, formats = null) {
  const props = {};
  for (const raw of fields || []) {
    const resolved = propertyRegistry?.resolve?.(raw) || raw;
    const key = String(resolved?.key || raw?.key || "").trim();
    if (!key) continue;
    props[key] = describeProperty(resolved, propertyRegistry, formats);
  }
  return props;
}

function primitiveType(type, defaultValue) {
  if (type === "integer" || type === "number" || type === "boolean" || type === "json") return type;
  if (type === "block-array") return "array";
  if (Array.isArray(defaultValue)) return "array";
  if (defaultValue && typeof defaultValue === "object") return "object";
  return "string";
}

function enumValues(schema = {}) {
  const source = Array.isArray(schema.options) ? schema.options : Array.isArray(schema.values) ? schema.values : [];
  return source.map(item => item && typeof item === "object" ? item.value : item).filter(value => value !== undefined);
}

function compactDefault(value) {
  if (value === "" || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}
