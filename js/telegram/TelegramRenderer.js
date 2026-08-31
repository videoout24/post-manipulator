import { buildSemanticRichText, makeUrlButton } from "../core/SemanticRichText.js?v=1.5.9";
import { renderableRichText } from "../links/LinkRelationAst.js?v=1.5.9";

/*
  Telegram wire adapter.
  Internal AST stays editor-centric. Semantic Builder blocks are lowered to ordinary
  RichText-in-Paragraph wire objects, while URL Button nodes become reply_markup.
*/
export class TelegramRenderer {
  constructor(registry) { this.registry = registry; }

  render(tree, { allowThinking = false } = {}) {
    const blocks = this.#renderChildren(tree.root?.children || [], { allowThinking, tree });
    return compactObject({ blocks });
  }

  renderEnvelope(tree, { allowThinking = false } = {}) {
    const richMessage = this.render(tree, { allowThinking });
    const buttons = [];
    tree.walk(node => {
      if (node.type !== "url_button") return;
      const button = makeUrlButton(node.props || {});
      if (button) buttons.push([button]);
    });
    return {
      richMessage,
      // Always provide the keyboard, including an empty keyboard, so editMessageText
      // can remove buttons that existed in the previous preview snapshot.
      replyMarkup: { inline_keyboard: buttons }
    };
  }

  #renderChildren(children, options) {
    return (children || []).flatMap(node => this.#renderNode(node, options));
  }

  #renderNode(node, options) {
    const definition = this.registry.get(node.type);
    if (definition?.kind === "meta") return this.#renderChildren(node.children || [], options);
    if (definition?.wire?.kind === "reply_markup" || node.type === "url_button") return [];
    return [this.#renderBlock(node, options)];
  }

  #renderBlock(node, options) {
    const p = node.props || {};
    const blocks = () => this.#renderChildren(node.children || [], options);
    const caption = () => makeCaption(p.caption, p.captionCredit);

    switch (node.type) {
      case "paragraph":
        return { type: "paragraph", text: richText(p.text) };
      case "heading":
        return { type: "heading", text: richText(p.text), size: integer(p.level, 1) };
      case "preformatted":
        return compactObject({ type: "pre", text: richText(p.text), language: optionalString(p.language) });
      case "footer":
        return { type: "footer", text: richText(p.text) };
      case "divider":
        return { type: "divider" };
      case "mathematical_expression":
        return { type: "mathematical_expression", expression: String(p.expression || "") };
      case "anchor":
        return { type: "anchor", name: String(p.name || "") };
      case "date_time":
      case "phone":
      case "email":
      case "hashtag":
      case "text_link":
      case "anchor_link":
        return { type: "paragraph", text: buildSemanticRichText(node.type, p, options.tree) };
      case "list":
        return { type: "list", items: this.#renderListItems(node) };
      case "block_quotation": {
        const quoteBlocks = richTextHasContent(p.text)
          ? [{ type: "paragraph", text: richText(p.text) }]
          : blocks();
        return compactObject({ type: "blockquote", blocks: quoteBlocks, credit: optionalRichText(p.credit) });
      }
      case "expandable_block_quotation": {
        return compactObject({ type: "expandable_blockquote", text: richText(p.text), credit: optionalRichText(p.credit) });
      }
      case "pull_quotation":
        return compactObject({ type: "pullquote", text: richText(p.text), credit: optionalRichText(p.credit) });
      case "collage":
        return compactObject({ type: "collage", blocks: blocks(), caption: caption() });
      case "slideshow":
        return compactObject({ type: "slideshow", blocks: blocks(), caption: caption() });
      case "table":
        return compactObject({
          type: "table",
          cells: renderTableCells(p.cells),
          is_bordered: truthyOnly(p.isBordered),
          is_striped: truthyOnly(p.isStriped),
          is_compact: truthyOnly(p.isCompact),
          caption: optionalRichText(p.caption)
        });
      case "details":
        return compactObject({ type: "details", summary: richText(p.summary), blocks: blocks(), is_open: truthyOnly(p.open) });
      case "map":
        return compactObject({
          type: "map",
          location: renderLocation(p),
          zoom: integer(p.zoom, 12),
          width: integer(p.width, 640),
          height: integer(p.height, 360),
          caption: caption()
        });
      case "animation":
        return compactObject({ type: "animation", animation: makeInputMedia("animation", (p.fileId || p.url), p.hasSpoiler), caption: caption() });
      case "audio":
        return compactObject({ type: "audio", audio: makeInputMedia("audio", (p.fileId || p.url)), caption: caption() });
      case "document":
        return compactObject({ type: "document", document: makeInputMedia("document", (p.fileId || p.url)), caption: caption() });
      case "photo":
        return compactObject({ type: "photo", photo: makeInputMedia("photo", (p.fileId || p.url), p.hasSpoiler), caption: caption() });
      case "video":
        return compactObject({ type: "video", video: makeInputMedia("video", (p.fileId || p.url), p.hasSpoiler), caption: caption() });
      case "voice_note":
        return compactObject({ type: "voice_note", voice_note: makeInputMedia("voice_note", (p.fileId || p.url)), caption: caption() });
      case "thinking":
        if (!options.allowThinking) throw new Error("Блок Thinking можно отправлять только через sendRichMessageDraft, а не в постоянном предпросмотре");
        return { type: "thinking", text: richText(p.text) };
      default:
        throw new Error(`Telegram renderer: неизвестный тип блока ${node.type}`);
    }
  }

  #renderListItems(node) {
    const p = node.props || {};
    const configured = Array.isArray(p.items) ? p.items : [];
    if (configured.length) {
      return configured.map((item, index) => {
        const itemBlocks = Array.isArray(item?.blocks)
          ? item.blocks.flatMap(block => this.#renderLooseBlock(block))
          : [];
        return compactObject({
          blocks: itemBlocks,
          has_checkbox: truthyOnly(item?.has_checkbox),
          is_checked: item?.has_checkbox ? truthyOnly(item?.is_checked) : undefined,
          value: optionalString(item?.type) ? optionalInteger(item?.value) : undefined,
          type: optionalString(item?.type)
        });
      });
    }

    return (node.children || []).map((child, index) => compactObject({
      blocks: this.#renderNode(child, { allowThinking: false }),
      value: undefined,
      type: undefined
    }));
  }

  #renderLooseBlock(block) {
    if (!block || typeof block !== "object") return [];
    if (block.props || block.children || block.id) return this.#renderNode(block, { allowThinking: false, tree: null });
    return [structuredClone(block)];
  }
}

function richTextHasContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

function richText(value) {
  if (value == null) return "";
  if (typeof value === "string" || Array.isArray(value)) return renderableRichText(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return renderableRichText(value);
  return String(value);
}

function optionalRichText(value) {
  if (value == null || value === "") return undefined;
  return richText(value);
}

function makeCaption(text, credit) {
  if ((text == null || text === "") && (credit == null || credit === "")) return undefined;
  return compactObject({ text: richText(text || ""), credit: optionalRichText(credit) });
}

function makeInputMedia(type, source, hasSpoiler = false) {
  if (!source) return undefined;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return compactObject({ type, ...structuredClone(source), has_spoiler: truthyOnly(source.has_spoiler ?? hasSpoiler) });
  }
  return compactObject({ type, media: String(source), has_spoiler: truthyOnly(hasSpoiler) });
}

function renderTableCells(value) {
  if (!Array.isArray(value)) return [];
  return value.map(row => (Array.isArray(row) ? row : []).filter(cell => !cell?._mergedInto).map(cell => compactObject({
    text: richText(cell?.text ?? ""),
    is_header: truthyOnly(cell?.is_header),
    colspan: greaterThanOne(cell?.colspan),
    rowspan: greaterThanOne(cell?.rowspan),
    align: optionalString(cell?.align) || "center",
    valign: optionalString(cell?.valign) || "middle"
  })));
}

function renderLocation(props) {
  const location = props.location && typeof props.location === "object" ? structuredClone(props.location) : {};
  const latitude = finite(location.latitude) ? Number(location.latitude) : Number(props.latitude || 0);
  const longitude = finite(location.longitude) ? Number(location.longitude) : Number(props.longitude || 0);
  return { ...location, latitude, longitude };
}

function integer(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function optionalInteger(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
function greaterThanOne(value) {
  const n = optionalInteger(value);
  return n && n > 1 ? n : undefined;
}
function optionalString(value) {
  return value == null || value === "" ? undefined : String(value);
}
function truthyOnly(value) { return value === true ? true : undefined; }
function finite(value) { return Number.isFinite(Number(value)); }
function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
