import { randomUUID } from "./Random.js?v=1.5.9";
import { richTextToPlain } from "./RichText.js?v=1.5.9";
import { t } from "../i18n/index.js?v=1.12.0";

export const COMESSAGE_PREFIX = "#comessage_";
const COMESSAGE_PATTERN = /^#comessage_[A-Za-z0-9_]{6,96}$/;

export function createComessageValue() {
  return `${COMESSAGE_PREFIX}${randomUUID().replaceAll("-", "")}`;
}

export function isComessageValue(value) {
  return COMESSAGE_PATTERN.test(String(value || "").trim());
}

export function comessageValueFromRichText(value) {
  const plain = richTextToPlain(value).trim();
  if (!isComessageValue(plain)) return "";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.type !== "hashtag") return "";
    return plain;
  }
  // String input is kept for compatibility with early Rich Message fixtures;
  // current editor output always uses the semantic hashtag RichText object.
  return plain;
}

export function comessageValueFromRichMessage(richMessage) {
  const blocks = Array.isArray(richMessage?.blocks) ? richMessage.blocks : [];
  const first = blocks[0];
  if (!first || first.type !== "paragraph") return "";
  return comessageValueFromRichText(first.text);
}

export function comessageValueFromAst(ast) {
  const children = Array.isArray(ast?.children) ? ast.children : [];
  const first = children[0];
  if (!first || first.type !== "comessage") return "";
  const value = String(first.props?.hashtag || "").trim();
  return isComessageValue(value) ? value : "";
}

export function comessageNodes(ast) {
  const found = [];
  const visit = node => {
    if (node?.type === "comessage") found.push(node);
    for (const child of node?.children || []) visit(child);
  };
  visit(ast);
  return found;
}

export function comessageKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function comessagePublicationId(chatId, value) {
  const channel = String(Math.abs(Number(chatId) || 0));
  const marker = comessageKey(value).replace(/^#/, "").replace(/[^a-z0-9_]/g, "_");
  return `comessage_${channel}_${marker}`;
}

export function comessageMutationError({ action, nodeId, node, type, parentId, index }, {
  tree,
  draftSession,
  projectSession
} = {}) {
  const target = node || tree?.find?.(nodeId);
  const marker = target?.type === "comessage" ? target : null;
  const existing = comessageNodes(tree?.root || null);
  const published = draftSession?.draft?.source?.kind === "publication"
    && Boolean(draftSession.draft.source.publicationId);

  if (action === "add" && type === "comessage") {
    if (projectSession?.isProjectActive?.()) return t("core.comessage.draftsOnly");
    if (published) return t("core.comessage.addPublishedBlocked");
    if (existing.length) return t("core.comessage.onlyOne");
    if (parentId && parentId !== "root") return t("core.comessage.mustBeFirst");
  }
  if (action === "add" && type !== "comessage" && parentId === "root" && existing.length && Number(index) <= 0) {
    return t("core.comessage.nothingBefore");
  }
  if (action === "duplicate" && marker) return t("core.comessage.cannotDuplicate");
  if (action === "change-type" && marker) return t("core.comessage.typeImmutable");
  if (action === "property" && marker) return t("core.comessage.identityImmutable");
  if (action === "move" && marker) return t("core.comessage.pinnedFirst");
  if (action === "move" && !marker && parentId === "root" && existing.length && Number(index) <= 0) {
    return t("core.comessage.nothingBefore");
  }
  if (action === "remove" && marker && published) {
    return t("core.comessage.deletePublicationFirst");
  }
  return "";
}
