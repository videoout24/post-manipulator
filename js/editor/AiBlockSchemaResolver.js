export function resolveAiBlockSchemas(messageAst, registry) {
  const schemas = {};
  const seen = new Set();
  walk(messageAst, node => {
    const type = String(node?.type || "").trim();
    if (!type || type === "document" || seen.has(type)) return;
    seen.add(type);
    const definition = registry?.get?.(type);
    if (!definition) return;
    schemas[type] = describeBlock(definition, registry);
  });
  return schemas;
}

function describeBlock(definition, registry) {
  const props = {};
  for (const binding of registry?.propertyBindings?.(definition) || definition?.propertyBindings || []) {
    const key = String(binding?.key || "").trim();
    if (!key) continue;
    props[key] = describeProperty(binding, registry?.properties);
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

function describeProperty(schema = {}, propertyRegistry = null) {
  const type = String(schema.type || "string");
  let result;
  if (type === "list-items") {
    result = {
      type: "array",
      items: {
        type: "object",
        props: describeNestedFields(schema.item?.fields, propertyRegistry)
      }
    };
  } else if (type === "table") {
    result = {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          props: describeNestedFields(schema.cell?.fields, propertyRegistry)
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
    result = {
      type: "rich-text",
      accepts: ["string", "rich-text object", "rich-text array"],
      ...(Array.isArray(schema.formats) && schema.formats.length ? { formats: [...schema.formats] } : {})
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

function describeNestedFields(fields = [], propertyRegistry = null) {
  const props = {};
  for (const raw of fields || []) {
    const resolved = propertyRegistry?.resolve?.(raw) || raw;
    const key = String(resolved?.key || raw?.key || "").trim();
    if (!key) continue;
    props[key] = describeProperty(resolved, propertyRegistry);
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
