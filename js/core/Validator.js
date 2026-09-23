import { TELEGRAM_LIMITS, treeStats } from "./DocumentLimits.js?v=1.7.17";
import { richTextToPlain } from "./RichText.js?v=1.5.9";
import { hasMediaSourceConflict, supportsExternalMediaUrl } from "./MediaSource.js?v=1.11.4";
import { MapLinkError, resolveMapLink } from "./MapLinkResolver.js?v=1.11.4";
import { comessageNodes, isComessageValue } from "./Comessage.js?v=1.12.1";

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
      const alternative = schema.alternativeKey ? node.props?.[schema.alternativeKey] : null;
      if (schema.required && isMissingRequiredValue(value, schema) && isMissingValue(alternative)) {
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
    if (supportsExternalMediaUrl(node.type) && node.props?.url && !isTelegramMediaSource(node.props.url, node.props.fileId)) {
      errors.push(`${node.type}.url must be an HTTPS URL or Telegram file_id`);
    }
    if (hasMediaSourceConflict(node)) {
      errors.push(`${node.type} cannot use both an external URL and Gallery/file_id`);
    }
    if (node.type === "map" && String(node.props?.mapUrl || "").trim()) {
      try {
        resolveMapLink(node.props?.mapUrl);
      } catch (error) {
        errors.push(error instanceof MapLinkError
          ? "map.mapUrl must contain latitude and longitude"
          : "map.mapUrl could not be resolved");
      }
    }
    if (node.type === "comessage" && !isComessageValue(node.props?.hashtag)) {
      errors.push("comessage.hashtag must match #comessage_<random>");
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
    const entries = publicationEntries(tree);
    const stats = publicationStats(tree, this.registry);
    if (stats.blockCount === 0) {
      errors.push("Rich Message requires at least 1 block");
    }
    for (const { node, parent } of entries) {
      errors.push(...this.validateNode(node, parent));
    }

    const anchors = new Map();
    const includedIds = new Set(entries.map(({ node }) => String(node.id)));
    const comessages = comessageNodes(tree.root);
    if (comessages.length > 1) errors.push("A Rich Message can contain only one #comessage marker");
    if (comessages.length && tree.root?.children?.[0] !== comessages[0]) {
      errors.push("#comessage must be the first block");
    }
    for (const { node } of entries) {
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
          if (!anchor || anchor.type !== "anchor" || !includedIds.has(String(anchor.id))) {
            errors.push(`anchor_link target is missing: ${target}`);
          }
        }
      }
      if (node.type === "date_time") {
        const date = new Date(String(node.props?.dateTime || ""));
        if (!Number.isFinite(date.getTime())) errors.push("date_time.dateTime is invalid");
      }
    }

    if (stats.blockCount > TELEGRAM_LIMITS.maxBlocks) {
      errors.push(`Block count ${stats.blockCount} / ${TELEGRAM_LIMITS.maxBlocks} exceeds Telegram Rich Message limit`);
    }
    if (stats.maxDepth > TELEGRAM_LIMITS.maxDepth) {
      errors.push(`Nesting depth ${stats.maxDepth} / ${TELEGRAM_LIMITS.maxDepth} exceeds Telegram Rich Message limit`);
    }
    return errors;
  }
}

function publicationEntries(tree) {
  const entries = [];
  const visit = (node, parent) => {
    entries.push({ node, parent });
    if (node.type === "visibility_group" && node.props?.included === false) return;
    for (const child of node.children || []) visit(child, node);
  };
  for (const child of tree.root?.children || []) visit(child, tree.root);
  return entries;
}

function publicationStats(tree, registry) {
  let blockCount = 0;
  let maxDepth = 0;

  const visit = (node, depth) => {
    if (node.type === "visibility_group") {
      if (node.props?.included === false) return;
      for (const child of node.children || []) visit(child, depth);
      return;
    }
    if (registry.get(node.type)?.kind === "meta") {
      for (const child of node.children || []) visit(child, depth);
      return;
    }

    blockCount++;
    maxDepth = Math.max(maxDepth, depth);
    if (node.type === "button_row") return;
    for (const child of node.children || []) visit(child, depth + 1);
  };

  for (const child of tree.root?.children || []) visit(child, 1);
  return { blockCount, maxDepth };
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

function isTelegramMediaSource(value, fileId = "") {
  const source = String(value || "").trim();
  return /^https:\/\//i.test(source)
    || (source && source === String(fileId || "").trim())
    || /^[A-Za-z0-9_-]{20,}$/.test(source);
}
