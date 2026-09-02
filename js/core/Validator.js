import { TELEGRAM_LIMITS, treeStats } from "./DocumentLimits.js?v=1.5.9";
import { richTextToPlain } from "./RichText.js?v=1.5.9";

export class Validator {
  constructor(registry) { this.registry = registry; }

  validateNode(node, parent = null) {
    // "document" is the editor's internal root container, not a registered
    // Telegram block, so it is intentionally excluded from block validation.
    if (node.id === "root" && node.type === "document") return [];

    const def = this.registry.get(node.type);
    if (!def) return [`Unknown block type: ${node.type}`];
    const errors = [];

    for (const [key, schema] of Object.entries(def.properties || {})) {
      const value = node.props?.[key];
      if (schema.required && isMissingRequiredValue(value, schema)) {
        errors.push(`${node.type}.${key} is required`);
      }
      if (!isMissingValue(value) && schema.type === "integer" && !Number.isInteger(value)) {
        errors.push(`${node.type}.${key} must be integer`);
      }
      if (!isMissingValue(value) && schema.min !== undefined && value < schema.min) errors.push(`${key} < min`);
      if (!isMissingValue(value) && schema.max !== undefined && value > schema.max) errors.push(`${key} > max`);
      if (schema.values && !isMissingValue(value) && !schema.values.includes(value)) {
        errors.push(`${key} has invalid value`);
      }
    }

    if (node.type === "list") {
      errors.push(...validateListMode(node.props?.items));
    }

    if (parent && parent.id !== "root" && def.constraints?.allowedParents &&
        !def.constraints.allowedParents.includes(parent.type)) {
      errors.push(`${node.type} cannot be child of ${parent.type}`);
    }

    const childConfig = def.children || {};
    const children = node.children || [];
    if (childConfig.allowed === false && children.length) {
      errors.push(`${node.type} does not allow children`);
    }
    if (childConfig.minItems != null && children.length < childConfig.minItems) {
      errors.push(`${node.type} requires at least ${childConfig.minItems} child block${childConfig.minItems === 1 ? "" : "s"}`);
    }
    if (childConfig.maxItems != null && children.length > childConfig.maxItems) {
      errors.push(`${node.type} has too many children`);
    }
    if (childConfig.types) {
      for (const child of children) {
        if (!childConfig.types.includes(child.type)) {
          errors.push(`${child.type} is not allowed inside ${node.type}`);
        }
      }
    }
    return errors;
  }

  stats(tree) {
    return treeStats(tree);
  }

  invalidNodeIds(tree) {
    const invalid = new Set();
    for (const child of tree.root.children || []) {
      tree.walk((node, parent) => {
        if (this.validateNode(node, parent).length) invalid.add(String(node.id));
      }, child, tree.root);
    }

    const anchors = new Map();
    tree.walk(node => {
      if (node.id === "root") return;
      if (node.type === "anchor") {
        const name = String(node.props?.name || "").trim();
        if (name && anchors.has(name)) {
          invalid.add(String(anchors.get(name)));
          invalid.add(String(node.id));
        } else if (name) anchors.set(name, node.id);
      }
      if (node.type === "anchor_link") {
        const target = String(node.props?.targetAnchorId || "");
        if (target) {
          const anchor = tree.find(target);
          if (!anchor || anchor.type !== "anchor") invalid.add(String(node.id));
        }
      }
      if (node.type === "date_time") {
        const date = new Date(String(node.props?.dateTime || ""));
        if (!Number.isFinite(date.getTime())) invalid.add(String(node.id));
      }
    });
    return invalid;
  }

  validate(tree) {
    const errors = [];
    if (!(tree.root.children || []).length) {
      errors.push("Rich Message requires at least 1 block");
    } else if (!(tree.root.children || []).some(node => node.type !== "url_button")) {
      errors.push("Rich Message requires at least 1 content block; URL Button is reply markup, not RichBlock content");
    }
    for (const child of tree.root.children || []) {
      tree.walk((node, parent) => errors.push(...this.validateNode(node, parent)), child, tree.root);
    }

    const anchors = new Map();
    tree.walk(node => {
      if (node.id === "root") return;
      if (node.type === "anchor") {
        const name = String(node.props?.name || "").trim();
        if (name) {
          if (anchors.has(name)) errors.push(`Duplicate anchor name: ${name}`);
          else anchors.set(name, node.id);
        }
      }
      if (node.type === "anchor_link") {
        const target = String(node.props?.targetAnchorId || "");
        if (target) {
          const anchor = tree.find(target);
          if (!anchor || anchor.type !== "anchor") errors.push(`anchor_link target is missing: ${target}`);
        }
      }
      if (node.type === "date_time") {
        const date = new Date(String(node.props?.dateTime || ""));
        if (!Number.isFinite(date.getTime())) errors.push("date_time.dateTime is invalid");
      }
    });

    const stats = this.stats(tree);
    if (stats.blockCount > TELEGRAM_LIMITS.maxBlocks) {
      errors.push(`Block count ${stats.blockCount} / ${TELEGRAM_LIMITS.maxBlocks} exceeds Telegram Rich Message limit`);
    }
    if (stats.maxDepth > TELEGRAM_LIMITS.maxDepth) {
      errors.push(`Nesting depth ${stats.maxDepth} / ${TELEGRAM_LIMITS.maxDepth} exceeds Telegram Rich Message limit`);
    }
    return errors;
  }
}

function isMissingRequiredValue(value, schema = {}) {
  if (isMissingValue(value)) return true;
  if (schema.type === "rich-text" || schema.editor === "rich-text") {
    return richTextToPlain(value).trim().length === 0;
  }
  if (schema.type === "media") {
    if (typeof value === "object" && value && !Array.isArray(value)) {
      return !String(value.media || value.file_id || value.fileId || value.url || "").trim();
    }
  }
  return false;
}

function isMissingValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateListMode(items) {
  if (!Array.isArray(items) || items.length < 2) return [];
  const ordered = items.map(item => String(item?.type ?? "").trim().length > 0);
  if (ordered.some(Boolean) && ordered.some(value => !value)) {
    return ["list items must be either all ordered or all unordered"];
  }
  return [];
}
