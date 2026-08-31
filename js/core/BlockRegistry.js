import { randomUUID } from "./Random.js?v=1.5.9";

export class BlockRegistry {
  constructor(propertyRegistry) {
    this.blocks = new Map();
    this.properties = propertyRegistry;
  }

  register(definition) {
    if (!definition?.type) throw new Error("Block definition requires type");
    const normalized = this.normalizeDefinition(definition);
    this.blocks.set(normalized.type, normalized);
    return normalized;
  }

  normalizeDefinition(definition) {
    const def = structuredClone(definition);
    const bindings = [];

    if (Array.isArray(def.accepts?.properties)) {
      for (const raw of def.accepts.properties) {
        const binding = typeof raw === "string" ? { property: raw } : raw;
        const resolved = this.properties?.resolve(binding);
        if (!resolved) throw new Error(`${def.type}: unknown property ${binding.property}`);
        bindings.push(resolved);
      }
    } else {
      // Compatibility for user-created Meta Blocks and old saved definitions.
      for (const [key, schema] of Object.entries(def.properties || {})) {
        bindings.push({
          property: schema.property || `inline.${def.type}.${key}`,
          key,
          inline: true,
          ...structuredClone(schema)
        });
      }
    }

    def.propertyBindings = bindings;
    // Materialized legacy view keeps Validator, Meta Blocks and older extensions working.
    def.properties = Object.fromEntries(bindings.map(binding => [
      binding.key,
      {
        ...structuredClone(binding),
        semanticProperty: binding.property
      }
    ]));
    return def;
  }

  cloneSubtree(source) {
    if (!source) return null;
    const copy = structuredClone(source);
    const pairs = [];
    collectPairs(source, copy, pairs);
    const identityMaps = new Map();

    for (const [original, cloned] of pairs) {
      cloned.id = randomUUID();
      const identity = this.get(original.type)?.cloneIdentity || {};
      for (const item of identity.ids || []) {
        const oldId = stringId(original.props?.[item.property]);
        if (!oldId) continue;
        const nextId = `${prefixForKind(item.kind)}_${randomUUID()}`;
        cloned.props ||= {};
        cloned.props[item.property] = nextId;
        rememberIdentity(identityMaps, item.kind, oldId, nextId);
      }
      for (const item of identity.collectionIds || []) {
        const originalItems = Array.isArray(original.props?.[item.property]) ? original.props[item.property] : [];
        const clonedItems = Array.isArray(cloned.props?.[item.property]) ? cloned.props[item.property] : [];
        for (let index = 0; index < Math.min(originalItems.length, clonedItems.length); index += 1) {
          const oldId = stringId(originalItems[index]?.[item.idKey]);
          if (!oldId) continue;
          const nextId = `${prefixForKind(item.kind)}_${randomUUID()}`;
          clonedItems[index][item.idKey] = nextId;
          rememberIdentity(identityMaps, item.kind, oldId, nextId);
        }
      }
    }

    for (const [original, cloned] of pairs) {
      const identity = this.get(original.type)?.cloneIdentity || {};
      for (const ref of identity.references || []) {
        const oldId = stringId(original.props?.[ref.property]);
        const nextId = identityMaps.get(ref.kind)?.get(oldId);
        if (!nextId) continue;
        cloned.props ||= {};
        cloned.props[ref.property] = nextId;
      }
    }
    return copy;
  }

  get(type) { return this.blocks.get(type); }
  has(type) { return this.blocks.has(type); }
  unregister(type) { return this.blocks.delete(type); }
  all() { return [...this.blocks.values()]; }
  propertyBindings(typeOrDefinition) {
    const def = typeof typeOrDefinition === "string" ? this.get(typeOrDefinition) : typeOrDefinition;
    return def?.propertyBindings || [];
  }

  search(query = "") {
    const q = query.trim().toLowerCase();
    return this.all().filter(b => {
      if (!q) return true;
      return [b.type, b.name, b.paletteLabel, ...(b.paletteAliases || [])]
        .filter(Boolean).some(value => String(value).toLowerCase().includes(q));
    });
  }
}


function collectPairs(source, copy, out) {
  out.push([source, copy]);
  const sourceChildren = source?.children || [];
  const copyChildren = copy?.children || [];
  for (let i = 0; i < Math.min(sourceChildren.length, copyChildren.length); i += 1) collectPairs(sourceChildren[i], copyChildren[i], out);
}

function rememberIdentity(maps, kind = "identity", oldId, newId) {
  if (!maps.has(kind)) maps.set(kind, new Map());
  maps.get(kind).set(oldId, newId);
}

function prefixForKind(kind = "identity") {
  if (kind === "project-map") return "map";
  if (kind === "project-slot") return "slot";
  return "id";
}

function stringId(value) { return value == null ? "" : String(value).trim(); }
