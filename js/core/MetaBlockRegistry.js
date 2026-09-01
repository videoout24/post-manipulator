import { t } from "../i18n/index.js?v=1.8.0";

export class MetaBlockRegistry {
  constructor(blockRegistry, options = "rich-message-meta-blocks") {
    this.blockRegistry = blockRegistry;
    if (typeof options === "string") {
      this.db = null;
      this.initialBlocks = [];
    } else {
      this.db = options.db || null;
      this.initialBlocks = options.initialBlocks;
    }
    this.load();
  }

  load() {
    let changed = false;
    try {
      const raw = this.initialBlocks;
      this.blocks = Array.isArray(raw) ? structuredClone(raw) : [];
    } catch {
      this.blocks = [];
    }

    this.blocks = this.blocks.map(block => {
      const { block: migrated, changed: blockChanged } = migrateDefinition(block);
      const { block: catalogued, changed: catalogChanged } = catalogueMetaProperties(
        migrated,
        this.blockRegistry.properties
      );
      changed ||= blockChanged || catalogChanged;
      return catalogued;
    });

    for (const block of this.blocks) this.blockRegistry.register(block);
    if (changed) this.save();
  }

  save() {
    if (this.db) {
      this.db.put("settings", "editor.metaBlocks", this.blocks)
        .catch(error => console.error("IndexedDB meta block save failed", error));
    }
  }

  create({ type, name, category = t("core.metaBlockRegistry.custom"), sourceNodeIds, tree, parameters = [] }) {
    if (!type || !name) throw new Error(t("core.metaBlockRegistry.metaBlockRequiresTypeAndName"));
    if (this.blockRegistry.has(type)) throw new Error(t("core.metaBlockRegistry.blockTypeAlreadyExists", { 0: type }));

    const rootNodes = selectedRoots(tree, sourceNodeIds);
    if (!rootNodes.length) throw new Error(t("core.metaBlockRegistry.selectAtLeastOneBlock"));

    const paths = new Map();
    const template = rootNodes.map((node, rootIndex) =>
      cloneTemplate(node, [rootIndex], paths)
    );

    const bindings = parameters.map(p => {
      const path = paths.get(p.nodeId);
      if (!path) throw new Error(t("core.metaBlockRegistry.cannotBindProperty", { 0: p.nodeId }));
      return {
        key: p.key,
        path,
        prop: p.prop
      };
    });

    const propertyCatalog = this.blockRegistry.properties;
    const acceptedProperties = parameters.map(p => {
      let propertyId = p.property;
      if (!propertyId || !propertyCatalog?.has(propertyId)) {
        propertyId = `meta.${type}.${p.key}`;
        if (!propertyCatalog?.has(propertyId)) {
          propertyCatalog?.register(propertyId, {
            type: p.type || "string",
            editor: p.type === "rich-text" ? "rich-text" : undefined,
            label: p.label || p.key,
            group: p.group || t("core.metaBlockRegistry.metaBlock"),
            default: structuredClone(p.default ?? "")
          });
        }
      }
      return {
        property: propertyId,
        key: p.key,
        label: p.label || p.key,
        group: p.group || t("core.metaBlockRegistry.metaBlock"),
        default: structuredClone(p.default ?? ""),
        ...(p.formats?.length ? { formats: structuredClone(p.formats) } : {})
      };
    });

    const definition = {
      type,
      name,
      category,
      kind: "meta",
      accepts: { properties: acceptedProperties },
      // Meta blocks are containers. The template supplies their initial children,
      // but the editor does not artificially restrict further nesting.
      children: { allowed: true },
      template,
      bindings
    };

    this.blocks.push(definition);
    this.blockRegistry.register(definition);
    this.save();
    return definition;
  }

  remove(type) {
    const before = this.blocks.length;
    this.blocks = this.blocks.filter(b => b.type !== type);
    if (this.blocks.length === before) return false;
    this.blockRegistry.unregister(type);
    this.save();
    return true;
  }

  all() { return [...this.blocks]; }
}

function selectedRoots(tree, sourceNodeIds) {
  const selected = new Set(sourceNodeIds || []);
  const roots = [];

  tree.walk((node, parent) => {
    if (node.id === "root" || !selected.has(node.id)) return;

    let cursor = parent;
    while (cursor && cursor.id !== "root") {
      if (selected.has(cursor.id)) return;
      cursor = tree.parentOf(cursor.id);
    }
    roots.push(node);
  });

  return roots;
}

function cloneTemplate(node, path, paths) {
  paths.set(node.id, [...path]);
  return {
    type: node.type,
    props: structuredClone(node.props || {}),
    children: (node.children || []).map((child, index) =>
      cloneTemplate(child, [...path, index], paths)
    )
  };
}

function migrateDefinition(definition) {
  if (!definition || definition.kind !== "meta") {
    return { block: definition, changed: false };
  }

  let changed = false;
  const block = structuredClone(definition);

  if (block.children?.types || block.children?.maxItems != null) {
    block.children = { allowed: true };
    changed = true;
  }

  block.bindings = (block.bindings || []).map(binding => {
    if (Array.isArray(binding.path)) return binding;
    if (!binding.nodeId) return binding;

    const path = findTemplatePath(block.template || [], binding.nodeId);
    if (!path) return binding;
    changed = true;
    return { key: binding.key, path, prop: binding.prop };
  });

  // Template IDs were used only by v0.3 bindings. Once bindings have paths,
  // remove those transient IDs so future clones are independent of instance IDs.
  if ((block.bindings || []).every(b => Array.isArray(b.path))) {
    const stripIds = node => {
      if ("id" in node) {
        delete node.id;
        changed = true;
      }
      for (const child of node.children || []) stripIds(child);
    };
    for (const node of block.template || []) stripIds(node);
  }

  return { block, changed };
}

function findTemplatePath(template, nodeId) {
  let result = null;
  const walk = (node, path) => {
    if (result) return;
    if (node.id === nodeId) {
      result = path;
      return;
    }
    (node.children || []).forEach((child, index) => walk(child, [...path, index]));
  };
  template.forEach((node, index) => walk(node, [index]));
  return result;
}


function catalogueMetaProperties(definition, propertyRegistry) {
  if (!definition || definition.kind !== "meta" || definition.accepts?.properties || !definition.properties) {
    return { block: definition, changed: false };
  }

  const block = structuredClone(definition);
  const accepted = [];
  for (const [key, schema] of Object.entries(block.properties || {})) {
    const propertyId = schema.semanticProperty && propertyRegistry?.has(schema.semanticProperty)
      ? schema.semanticProperty
      : `meta.${block.type}.${key}`;

    if (!propertyRegistry?.has(propertyId)) {
      propertyRegistry?.register(propertyId, {
        type: schema.type || "string",
        editor: schema.editor || (schema.type === "rich-text" ? "rich-text" : undefined),
        label: schema.label || key,
        group: schema.group || t("core.metaBlockRegistry.metaBlock"),
        default: structuredClone(schema.default ?? "")
      });
    }

    accepted.push({
      property: propertyId,
      key,
      label: schema.label || key,
      group: schema.group || t("core.metaBlockRegistry.metaBlock"),
      default: structuredClone(schema.default ?? ""),
      ...(schema.formats?.length ? { formats: structuredClone(schema.formats) } : {})
    });
  }

  block.accepts = { properties: accepted };
  delete block.properties;
  return { block, changed: true };
}
