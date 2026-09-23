import { randomUUID } from "../core/Random.js?v=1.5.9";
import { comessageValueFromRichText } from "../core/Comessage.js?v=1.12.1";
import { richTextToPlain } from "../core/RichText.js?v=1.5.9";

export function importTelegramRichMessage(richMessage) {
  const blocks = Array.isArray(richMessage?.blocks) ? richMessage.blocks : [];
  const children = blocks.map((block, index) => importBlock(block, { first: index === 0 })).filter(Boolean);
  return { id: "root", type: "document", props: {}, children };
}

function importBlock(block, { first = false } = {}) {
  if (!block || typeof block !== "object") return null;
  const caption = importCaption(block.caption);
  switch (block.type) {
    case "paragraph": {
      const marker = first ? comessageValueFromRichText(block.text) : "";
      return marker
        ? node("comessage", { hashtag: marker })
        : node("paragraph", { text: clone(block.text) });
    }
    case "heading": return node("heading", { text: clone(block.text), level: integer(block.size, 1) });
    case "pre": return node("preformatted", { text: clone(block.text), language: String(block.language || "") });
    case "footer": return node("footer", { text: clone(block.text) });
    case "divider": return node("divider");
    case "mathematical_expression": return node("mathematical_expression", { expression: String(block.expression || "") });
    case "anchor": return node("anchor", { name: String(block.name || "") });
    case "list": return node("list", {
      items: (block.items || []).map(item => compact({
        blocks: (item?.blocks || []).map(child => importBlock(child)).filter(Boolean),
        has_checkbox: item?.has_checkbox === true,
        is_checked: item?.has_checkbox === true ? item?.is_checked === true : undefined,
        value: finite(item?.value),
        type: item?.type ? String(item.type) : undefined
      }))
    });
    case "blockquote": {
      const children = (block.blocks || []).map(child => importBlock(child)).filter(Boolean);
      if (children.length === 1 && children[0].type === "paragraph") {
        return node("block_quotation", { text: clone(children[0].props.text), credit: clone(block.credit || "") });
      }
      return node("block_quotation", { text: "", credit: clone(block.credit || "") }, children);
    }
    case "expandable_blockquote": return node("expandable_block_quotation", { text: clone(block.text), credit: clone(block.credit || "") });
    case "pullquote": return node("pull_quotation", { text: clone(block.text), credit: clone(block.credit || "") });
    case "collage": return node("collage", caption, (block.blocks || []).map(child => importBlock(child)).filter(Boolean));
    case "slideshow": return node("slideshow", caption, (block.blocks || []).map(child => importBlock(child)).filter(Boolean));
    case "table": return node("table", {
      cells: (block.cells || []).map(row => (row || []).map(cell => compact({
        text: clone(cell?.text ?? ""),
        is_header: cell?.is_header === true,
        colspan: integer(cell?.colspan, 1),
        rowspan: integer(cell?.rowspan, 1),
        align: String(cell?.align || "center"),
        valign: String(cell?.valign || "middle")
      }))),
      isBordered: block.is_bordered === true,
      isStriped: block.is_striped === true,
      isCompact: block.is_compact === true,
      caption: clone(block.caption || "")
    });
    case "details": return node("details", {
      summary: clone(block.summary),
      open: block.is_open === true
    }, (block.blocks || []).map(child => importBlock(child)).filter(Boolean));
    case "map": return node("map", {
      location: clone(block.location || {}),
      zoom: integer(block.zoom, 13),
      orientation: Number(block.height || 0) > Number(block.width || 0) ? "portrait" : "landscape",
      ...caption
    });
    case "buttons": {
      const buttons = (block.buttons || []).filter(button => button?.url).map(button => node("url_button", {
        text: richTextToPlain(button.text),
        url: String(button.url),
        buttonStyle: ["primary", "success", "danger"].includes(button.style) ? button.style : ""
      }));
      return buttons.length ? node("button_row", { buttonAlign: String(block.align || "") }, buttons) : null;
    }
    case "animation": return node("animation", {
      url: String(block.animation?.file_id || ""),
      hasSpoiler: block.has_spoiler === true,
      ...caption
    });
    case "audio": return node("audio", { fileId: String(block.audio?.file_id || ""), url: "", ...caption });
    case "document": return node("document", { fileId: String(block.document?.file_id || ""), url: "", ...caption });
    case "photo": {
      const sizes = Array.isArray(block.photo) ? block.photo : [];
      const photo = [...sizes].sort((a, b) => Number(a?.width || 0) * Number(a?.height || 0) - Number(b?.width || 0) * Number(b?.height || 0)).at(-1);
      return node("photo", { fileId: String(photo?.file_id || ""), url: "", hasSpoiler: block.has_spoiler === true, ...caption });
    }
    case "video": return node("video", { fileId: String(block.video?.file_id || ""), url: "", hasSpoiler: block.has_spoiler === true, ...caption });
    case "voice_note": return node("voice_note", { fileId: String(block.voice_note?.file_id || ""), url: "", ...caption });
    default: return null;
  }
}

function importCaption(value) {
  if (!value || typeof value !== "object") return {};
  return compact({ caption: clone(value.text ?? ""), captionCredit: clone(value.credit ?? "") });
}

function node(type, props = {}, children = []) {
  return { id: randomUUID(), type, props: compact(props), children };
}

function clone(value) {
  return value == null ? "" : structuredClone(value);
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}
