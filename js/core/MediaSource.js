const EXTERNAL_URL_MEDIA_TYPES = new Set([
  "animation", "audio", "document", "photo", "video", "voice_note"
]);

const DUAL_SOURCE_MEDIA_TYPES = new Set([
  "audio", "document", "photo", "video", "voice_note"
]);

export function supportsExternalMediaUrl(type) {
  return EXTERNAL_URL_MEDIA_TYPES.has(String(type || ""));
}

export function hasSeparateInternalMediaSource(type) {
  return DUAL_SOURCE_MEDIA_TYPES.has(String(type || ""));
}

export function isExternalMediaUrl(value) {
  return /^https:\/\//i.test(String(value || "").trim());
}

export function normalizeMediaSourcePatch(node, patch = {}) {
  const next = { ...patch };
  if (!hasSeparateInternalMediaSource(node?.type)) return next;

  const assignsExternalUrl = hasOwn(next, "url") && Boolean(String(next.url || "").trim());
  const assignsInternalSource = (hasOwn(next, "fileId") && Boolean(String(next.fileId || "").trim()))
    || (hasOwn(next, "galleryId") && Boolean(String(next.galleryId || "").trim()));

  if (assignsExternalUrl) {
    next.fileId = "";
    next.galleryId = "";
  } else if (assignsInternalSource) {
    next.url = "";
  }
  return next;
}

export function normalizeStoredMediaSource(node) {
  if (!hasSeparateInternalMediaSource(node?.type)) return node;
  node.props ||= {};
  const url = String(node.props.url || "").trim();
  const fileId = String(node.props.fileId || "").trim();

  if (isExternalMediaUrl(url)) {
    node.props.url = url;
    node.props.fileId = "";
    node.props.galleryId = "";
  } else if (!url && isExternalMediaUrl(fileId)) {
    node.props.url = fileId;
    node.props.fileId = "";
    node.props.galleryId = "";
  } else if (url) {
    if (!fileId) node.props.fileId = url;
    node.props.url = "";
  }
  return node;
}

export function hasMediaSourceConflict(node) {
  if (!hasSeparateInternalMediaSource(node?.type)) return false;
  const props = node?.props || {};
  return Boolean(String(props.url || "").trim())
    && Boolean(String(props.fileId || "").trim() || String(props.galleryId || "").trim());
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
