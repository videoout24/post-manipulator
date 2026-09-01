import { t } from "../i18n/index.js?v=1.8.0";
import { defaultDateTimeLocal } from "../core/SemanticRichText.js?v=1.5.9";
import { randomUUID } from "../core/Random.js?v=1.5.9";
import {
  TELEGRAM_LIMITS,
  countBlocks,
  countSubtree,
  definitionFootprint,
  depthOf,
  subtreeHeight
} from "../core/DocumentLimits.js?v=1.5.9";

export class EditorController {
  constructor({ tree, registry, validator, events, selection }) {
    this.tree = tree;
    this.registry = registry;
    this.validator = validator;
    this.events = events;
    this.selection = selection;
    this.mutationGuard = null;
    this.documentContextResolver = null;
  }

  get selectedId() { return this.selection.primary(); }

  setMutationGuard(guard) {
    this.mutationGuard = typeof guard === "function" ? guard : null;
  }

  setDocumentContextResolver(resolver) {
    this.documentContextResolver = typeof resolver === "function" ? resolver : null;
  }

  select(id, additive = false) {
    if (additive) this.selection.toggle(id);
    else this.selection.set(id);
  }

  preferredParentFor(type) {
    const selectedId = this.selectedId;
    if (selectedId && this.canAccept(selectedId, type)) return selectedId;
    return "root";
  }

  addBlock(type, parentId = "root", index = Infinity, { props: initialProps = null, select = true } = {}) {
    if (!this.hasDocumentContext()) {
      // Creating the first block is the one useful action available without an
      // open document. The command controller turns this request into a named
      // Draft and retries the insertion only after that Draft is active.
      this.events?.emit?.("editor:draft-create-requested", {
        type,
        parentId,
        index,
        options: {
          props: initialProps == null ? null : structuredClone(initialProps),
          select: Boolean(select)
        }
      });
      return null;
    }
    const guarded = this.mutationError("add", { type, parentId });
    if (guarded) {
      this.reportError(guarded);
      return null;
    }
    const def = this.registry.get(type);
    if (!def) return null;

    const error = this.acceptError(parentId, type);
    if (error) {
      this.reportError(error);
      return null;
    }

    const props = {};
    for (const [key, schema] of Object.entries(def.properties || {})) {
      if (schema.generateIdPrefix) props[key] = `${schema.generateIdPrefix}_${randomUUID()}`;
      else if (schema.default !== undefined) props[key] = structuredClone(schema.default);
    }
    if (initialProps && typeof initialProps === "object") {
      for (const [key, value] of Object.entries(initialProps)) props[key] = structuredClone(value);
    }
    if (type === "date_time" && !props.dateTime) props.dateTime = defaultDateTimeLocal();
    if (type === "anchor" && (!initialProps || !Object.prototype.hasOwnProperty.call(initialProps, "name"))) {
      props.name = this.nextAnchorName();
    }

    const node = this.tree.create(type, props);

    if (def.kind === "meta" && def.template) {
      const cloneTemplate = source => {
        const copy = this.tree.create(source.type, structuredClone(source.props || {}));
        copy.children = (source.children || []).map(cloneTemplate);
        return copy;
      };
      node.children = def.template.map(cloneTemplate);
      this.applyMetaBindings(node, def);
    }

    this.tree.insert(node, parentId, index);
    if (select) this.select(node.id);
    this.events.emit("tree:changed");
    return node;
  }

  removeBlock(nodeId) {
    if (!nodeId || nodeId === "root") return false;
    const guarded = this.mutationError("remove", { nodeId });
    if (guarded) {
      this.reportError(guarded);
      return false;
    }
    const removed = this.tree.remove(nodeId);
    if (!removed) return false;
    if (this.selection.all().some(id => !this.tree.find(id))) this.selection.clear();
    this.events.emit("tree:changed");
    return true;
  }

  removeSelected() {
    // Remove deepest selections first so a selected child does not disappear
    // before an independently selected ancestor is processed.
    const ids = this.selection.all().sort((a, b) => depthOf(this.tree, b) - depthOf(this.tree, a));
    let removed = false;
    for (const id of ids) {
      const guarded = this.mutationError("remove", { nodeId: id });
      if (guarded) {
        this.reportError(guarded);
        continue;
      }
      removed = this.tree.remove(id) || removed;
    }
    if (removed) this.events.emit("tree:changed");
    if (this.selection.all().some(id => !this.tree.find(id))) this.selection.clear();
  }

  duplicateSelected() {
    const ids = this.selection.all();
    if (ids.length !== 1) return;
    const node = this.tree.find(ids[0]);
    const parent = this.tree.parentOf(ids[0]);
    if (!node || !parent) return;
    const guarded = this.mutationError("duplicate", { nodeId: node.id, node });
    if (guarded) {
      this.reportError(guarded);
      return;
    }

    const error = this.subtreeAcceptError(parent.id, node, { copy: true });
    if (error) {
      this.reportError(error);
      return;
    }

    const copy = this.tree.duplicate(ids[0], { cloneSubtree: source => this.registry.cloneSubtree(source) });
    if (copy?.type === "anchor") copy.props.name = this.nextAnchorName();
    if (copy) this.select(copy.id);
    this.events.emit("tree:changed");
  }

  updateProperty(key, value) {
    this.updateNodeProperty(this.selectedId, key, value, { inspectorSource: true });
  }

  updateNodeProperty(nodeId, key, value, { inspectorSource = false } = {}) {
    const node = this.tree.find(nodeId);
    if (!node) return;
    const guarded = this.mutationError("property", { nodeId, node, key, value });
    if (guarded) {
      this.reportError(guarded);
      return;
    }
    node.props ||= {};
    node.props[key] = value;

    const def = this.registry.get(node.type);
    if (def?.kind === "meta") this.applyMetaBindings(node, def, key);
    this.syncPropertyBackToMeta(node, key, value);

    this.events.emit("tree:changed", inspectorSource ? { source: "property" } : undefined);
  }

  updateNodeProperties(nodeId, patch = {}, { inspectorSource = false } = {}) {
    const node = this.tree.find(nodeId);
    if (!node || !patch || typeof patch !== "object") return;
    for (const [key, value] of Object.entries(patch)) {
      const guarded = this.mutationError("property", { nodeId, node, key, value });
      if (guarded) {
        this.reportError(guarded);
        return;
      }
    }
    node.props ||= {};
    const def = this.registry.get(node.type);
    for (const [key, value] of Object.entries(patch)) {
      node.props[key] = structuredClone(value);
      if (def?.kind === "meta") this.applyMetaBindings(node, def, key);
      this.syncPropertyBackToMeta(node, key, value);
    }
    this.events.emit("tree:changed", inspectorSource ? { source: "property" } : { source: "bulk-property" });
  }

  changeNodeType(nodeId, nextType) {
    const node = this.tree.find(nodeId);
    const nextDef = this.registry.get(nextType);
    if (!node || !nextDef || node.type === nextType) return node;
    const guarded = this.mutationError("change-type", { nodeId, node, nextType });
    if (guarded) {
      this.reportError(guarded);
      return null;
    }
    const parent = this.tree.parentOf(nodeId);
    if (parent && parent.id !== "root") {
      const cfg = this.registry.get(parent.type)?.children || {};
      if (cfg.allowed === false || (cfg.types && !cfg.types.includes(nextType))) {
        this.reportError(`${nextType} is not allowed inside ${parent.type}`);
        return null;
      }
    }
    const nextChildren = nextDef.children || {};
    if (nextChildren.allowed === false && (node.children || []).length) {
      this.reportError(t("editor.editorController.doesNotAcceptNestedBlocks", { 0: nextDef.name || nextType }));
      return null;
    }
    if (Number.isFinite(nextChildren.maxItems) && (node.children || []).length > nextChildren.maxItems) {
      this.reportError(t("editor.editorController.maximumNestedBlocks", { 0: nextDef.name || nextType, 1: nextChildren.maxItems }));
      return null;
    }
    if (Array.isArray(nextChildren.types)) {
      const incompatible = (node.children || []).find(child => !nextChildren.types.includes(child.type));
      if (incompatible) {
        this.reportError(t("editor.editorController.doesNotAccept", { 0: nextDef.name || nextType, 1: incompatible.type }));
        return null;
      }
    }
    node.type = nextType;
    this.select(nodeId);
    this.events.emit("tree:changed", { source: "type" });
    return node;
  }

  applyMetaBindings(node, def, onlyKey = null) {
    for (const binding of def.bindings || []) {
      if (onlyKey != null && binding.key !== onlyKey) continue;
      const target = findByBinding(node, binding);
      if (target) {
        target.props ||= {};
        target.props[binding.prop] = structuredClone(node.props?.[binding.key] ?? "");
      }
    }
  }

  syncPropertyBackToMeta(node, prop, value) {
    let parent = this.tree.parentOf(node.id);

    while (parent && parent.id !== "root") {
      const def = this.registry.get(parent.type);
      if (def?.kind === "meta") {
        const path = pathFromAncestor(parent, node.id);
        if (path) {
          for (const binding of def.bindings || []) {
            if (binding.prop === prop && samePath(binding.path, path)) {
              parent.props[binding.key] = structuredClone(value);
            }
          }
        }
      }
      parent = this.tree.parentOf(parent.id);
    }
  }

  canAccept(parentId, childType, movingNodeId = null) {
    return !this.acceptError(parentId, childType, movingNodeId);
  }

  acceptError(parentId, childType, movingNodeId = null) {
    const parent = this.tree.find(parentId);
    const def = this.registry.get(childType);
    if (!parent) return t("editor.editorController.parentBlockNotFound");
    if (!def) return `Unknown block type: ${childType}`;
    if (parentId === movingNodeId) return t("editor.editorController.blockCannotNestInsideItself");

    if (movingNodeId) {
      const movingNode = this.tree.find(movingNodeId);
      if (!movingNode) return t("editor.editorController.draggedBlockNotFound");
      return this.subtreeAcceptError(parentId, movingNode, { movingNodeId });
    }

    const structuralError = this.structuralAcceptError(parent, childType, null);
    if (structuralError) return structuralError;

    const footprint = definitionFootprint(def);
    const nextCount = countBlocks(this.tree) + footprint.count;
    if (nextCount > TELEGRAM_LIMITS.maxBlocks) {
      return `Block limit: ${nextCount} / ${TELEGRAM_LIMITS.maxBlocks}`;
    }

    const nextDepth = depthOf(this.tree, parentId) + footprint.height;
    if (nextDepth > TELEGRAM_LIMITS.maxDepth) {
      return `Nesting depth limit: ${nextDepth} / ${TELEGRAM_LIMITS.maxDepth}`;
    }
    return "";
  }

  subtreeAcceptError(parentId, node, { movingNodeId = null, copy = false } = {}) {
    const parent = this.tree.find(parentId);
    if (!parent || !node) return t("editor.editorController.destinationNotFound");
    if (parentId === movingNodeId || parentId === node.id) return t("editor.editorController.blockCannotNestInsideItself");

    if (movingNodeId) {
      let cursor = parent;
      while (cursor) {
        if (cursor.id === movingNodeId) return t("editor.editorController.blockCannotMoveIntoDescendant");
        cursor = this.tree.parentOf(cursor.id);
      }
    }

    const structuralError = this.structuralAcceptError(parent, node.type, movingNodeId);
    if (structuralError) return structuralError;

    if (copy) {
      const nextCount = countBlocks(this.tree) + countSubtree(node);
      if (nextCount > TELEGRAM_LIMITS.maxBlocks) {
        return `Block limit: ${nextCount} / ${TELEGRAM_LIMITS.maxBlocks}`;
      }
    }

    const nextDepth = depthOf(this.tree, parentId) + subtreeHeight(node);
    if (nextDepth > TELEGRAM_LIMITS.maxDepth) {
      return `Nesting depth limit: ${nextDepth} / ${TELEGRAM_LIMITS.maxDepth}`;
    }
    return "";
  }

  structuralAcceptError(parent, childType, movingNodeId = null) {
    const childDef = this.registry.get(childType);
    const parentType = parent.id === "root" ? "document" : parent.type;
    if (childDef?.constraints?.allowedParents && !childDef.constraints.allowedParents.includes(parentType)) {
      return `${childType} is only allowed inside ${childDef.constraints.allowedParents.join(", ")}`;
    }
    // The document root is otherwise an unrestricted container.
    if (parent.id === "root") return "";

    const cfg = this.registry.get(parent.type)?.children || {};
    if (cfg.allowed === false) return `${parent.type} does not allow children`;
    if (cfg.types && !cfg.types.includes(childType)) return `${childType} is not allowed inside ${parent.type}`;

    if (cfg.maxItems != null) {
      const currentParent = movingNodeId ? this.tree.parentOf(movingNodeId) : null;
      const movingWithinSameParent = currentParent?.id === parent.id;
      const effectiveCount = (parent.children || []).length - (movingWithinSameParent ? 1 : 0);
      if (effectiveCount >= cfg.maxItems) return `${parent.type} child limit: ${cfg.maxItems}`;
    }
    return "";
  }

  moveBlock(nodeId, parentId, index = Infinity) {
    const node = this.tree.find(nodeId);
    if (!node) return false;
    const guarded = this.mutationError("move", { nodeId, node, parentId, index });
    if (guarded) {
      this.reportError(guarded);
      return false;
    }
    const error = this.subtreeAcceptError(parentId, node, { movingNodeId: nodeId });
    if (error) {
      this.reportError(error);
      return false;
    }
    if (!this.tree.move(nodeId, parentId, index)) return false;
    this.select(nodeId);
    this.events.emit("tree:changed");
    return true;
  }

  nextAnchorName() {
    const used = new Set();
    this.tree.walk(node => { if (node.type === "anchor") used.add(String(node.props?.name || "")); });
    let index = 1;
    while (used.has(`anchor-${index}`)) index += 1;
    return `anchor-${index}`;
  }

  reportError(message) {
    this.events.emit("ui:error", { message });
  }

  mutationError(action, payload = {}) {
    if (!this.hasDocumentContext()) return t("editor.editorController.firstOpenOrCreateADraft");
    return this.mutationGuard?.({ action, ...payload }) || "";
  }

  hasDocumentContext() {
    return !this.documentContextResolver || Boolean(this.documentContextResolver());
  }
}

function findByBinding(root, binding) {
  if (Array.isArray(binding.path)) return findByPath(root, binding.path);
  if (binding.nodeId) return findByLegacyId(root, binding.nodeId);
  return null;
}

function findByPath(root, path) {
  let node = root;
  for (const index of path || []) {
    node = node.children?.[index];
    if (!node) return null;
  }
  return node;
}

function findByLegacyId(root, id) {
  let found = null;
  const walk = n => {
    if (n.id === id) found = n;
    for (const c of n.children || []) if (!found) walk(c);
  };
  walk(root);
  return found;
}

function pathFromAncestor(ancestor, targetId) {
  let result = null;
  const walk = (node, path) => {
    if (result) return;
    if (node.id === targetId) {
      result = path;
      return;
    }
    (node.children || []).forEach((child, index) => walk(child, [...path, index]));
  };
  (ancestor.children || []).forEach((child, index) => walk(child, [index]));
  return result;
}

function samePath(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((value, index) => value === b[index]);
}
