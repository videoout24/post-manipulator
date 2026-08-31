import { isInternalLinkUrl } from "../links/LinkTarget.js?v=1.5.9";

export const DATE_TIME_FORMAT_OPTIONS = Object.freeze([
  { value: "r", label: "Относительная дата" },
  { value: "d", label: "Короткая дата" },
  { value: "D", label: "Полная дата" },
  { value: "t", label: "Короткое время" },
  { value: "T", label: "Полное время" },
  { value: "dt", label: "Короткие дата и время" },
  { value: "DT", label: "Полные дата и время" },
  { value: "wDT", label: "День недели, полная дата и время" }
]);

export const INLINE_SEMANTIC_TYPES = new Set([
  "date_time", "phone", "email", "hashtag", "text_link", "anchor_link"
]);

export function buildSemanticRichText(type, props = {}, tree = null) {
  switch (type) {
    case "date_time": {
      const unix = dateTimeLocalToUnix(props.dateTime);
      return {
        type: "date_time",
        text: dateTimeFallbackText(props.dateTime),
        unix_time: unix,
        date_time_format: String(props.dateTimeFormat || "DT")
      };
    }
    case "phone":
      return { type: "phone_number", text: String(props.text || props.phoneNumber || ""), phone_number: String(props.phoneNumber || "") };
    case "email":
      return { type: "email_address", text: String(props.text || props.email || ""), email_address: String(props.email || "") };
    case "hashtag": {
      const hashtag = normalizeHashtag(props.hashtag);
      return { type: "hashtag", text: hashtag, hashtag };
    }
    case "text_link":
      // A link relation may still wait for its target to be published. The
      // editor keeps a durable internal URL in props.url, but Telegram must see
      // ordinary text until that internal reference resolves to t.me.
      if (!String(props.url || "").trim() || isInternalLinkUrl(props.url)) return String(props.text || "");
      return { type: "url", text: String(props.text || props.url || ""), url: String(props.url || "") };
    case "anchor_link": {
      const target = resolveAnchorTarget(tree, props.targetAnchorId);
      return { type: "anchor_link", text: String(props.text || target.label || "Перейти"), anchor_name: target.name };
    }
    default:
      throw new Error(`Unknown semantic RichText type: ${type}`);
  }
}

export function dateTimeLocalToUnix(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return 0;
  return Math.floor(date.getTime() / 1000);
}

export function unixTimeToDateTimeLocal(value) {
  const date = new Date(Number(value) * 1000);
  return Number.isFinite(date.getTime()) ? defaultDateTimeLocal(date) : "";
}

export function dateTimeFormatMetadata({ dateTime, date_time_format = "" } = {}) {
  return {
    unix_time: dateTimeLocalToUnix(dateTime),
    date_time_format: String(date_time_format || "")
  };
}

export function dateTimeFallbackText(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "Дата / время";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleString?.() || String(value || "Дата / время");
  }
}

export function defaultDateTimeLocal(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeHashtag(value) {
  const raw = String(value || "").trim().replace(/^#+/, "");
  return raw ? `#${raw}` : "";
}

export function listAnchors(tree) {
  const out = [];
  tree?.walk?.(node => {
    if (node.type !== "anchor") return;
    out.push({ id: node.id, name: String(node.props?.name || ""), label: String(node.props?.name || "Без имени") });
  });
  return out;
}

export function resolveAnchorTarget(tree, targetAnchorId) {
  if (!targetAnchorId) return { id: "", name: "", label: "В начало сообщения" };
  const node = tree?.find?.(targetAnchorId);
  if (!node || node.type !== "anchor") return { id: String(targetAnchorId), name: "", label: "Якорь удалён" };
  const name = String(node.props?.name || "");
  return { id: node.id, name, label: name || "Без имени" };
}

export function makeUrlButton(props = {}) {
  if (!String(props.url || "").trim() || isInternalLinkUrl(props.url)) return null;
  const button = { text: String(props.text || "Открыть"), url: String(props.url || "") };
  if (["primary", "success", "danger"].includes(props.buttonStyle)) button.style = props.buttonStyle;
  return button;
}
