export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 20;

export const MAP_DIMENSIONS = Object.freeze({
  landscape: Object.freeze({ width: 640, height: 320 }),
  portrait: Object.freeze({ width: 320, height: 640 })
});

export class MapLinkError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "MapLinkError";
    this.code = code;
  }
}

export function resolveMapLink(value) {
  return resolveMapLinkInternal(String(value || "").trim(), 0);
}

export function normalizeMapZoom(value, fallback = 12) {
  const parsed = Number(value);
  const zoom = Number.isFinite(parsed) ? Math.round(parsed) : Number(fallback);
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Number.isFinite(zoom) ? zoom : 12));
}

export function mapOrientation(props = {}) {
  if (props?.orientation === "portrait" || props?.orientation === "landscape") return props.orientation;
  const width = Number(props?.width);
  const height = Number(props?.height);
  return Number.isFinite(width) && Number.isFinite(height) && height > width ? "portrait" : "landscape";
}

export function mapDimensions(orientation) {
  return MAP_DIMENSIONS[orientation === "portrait" ? "portrait" : "landscape"];
}

export function isShortMapLink(value) {
  const url = parseUrl(String(value || "").trim());
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return host === "maps.app.goo.gl"
    || (host === "goo.gl" && path.startsWith("/maps"))
    || (isYandexHost(host) && /^\/maps\/-\//.test(path))
    || host === "go.2gis.com"
    || host.endsWith(".maps.apple")
    || host === "maps.apple";
}

function resolveMapLinkInternal(source, depth) {
  if (!source) throw new MapLinkError("empty");
  if (depth > 2) throw new MapLinkError("coordinates");

  const url = parseUrl(source);
  if (!url) throw new MapLinkError("unsupported");

  const nested = url.searchParams.get("url");
  if (nested && nested !== source) {
    try { return resolveMapLinkInternal(decodeRepeated(nested), depth + 1); } catch (error) {
      if (!(error instanceof MapLinkError)) throw error;
    }
  }

  const provider = providerFor(url);
  let result = null;
  if (provider === "google") result = parseGoogle(url);
  else if (provider === "yandex") result = parseYandex(url);
  else if (provider === "apple") result = parseApple(url);
  else if (provider === "2gis") result = parse2gis(url);
  else if (provider === "telegram") result = parseTelegram(url);
  if (!provider) throw new MapLinkError("unsupported");
  if (!result && isShortMapLink(source)) throw new MapLinkError("short");
  if (!result) throw new MapLinkError("coordinates");

  return {
    provider,
    sourceUrl: source,
    location: result.location,
    ...(result.zoom == null ? {} : { zoom: normalizeMapZoom(result.zoom) })
  };
}

function parseGoogle(url) {
  const text = decodeRepeated(`${url.pathname}${url.search}${url.hash}`);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?)z)?/i.exec(text);
  if (at) return resultFromPair([at[1], at[2]], at[3]);

  const data = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i.exec(text);
  if (data) return resultFromPair([data[1], data[2]], queryZoom(url));

  for (const key of ["query", "q", "destination", "daddr", "center", "ll"]) {
    const pair = coordinatePair(url.searchParams.get(key));
    if (pair) return resultFromPair(pair, queryZoom(url));
  }

  const path = /\/(?:search|place|dir)\/(-?\d+(?:\.\d+)?)[,+\s]+(-?\d+(?:\.\d+)?)/i.exec(decodeRepeated(url.pathname));
  return path ? resultFromPair([path[1], path[2]], queryZoom(url)) : null;
}

function parseYandex(url) {
  for (const key of ["whatshere[point]", "pt", "ll"]) {
    const pair = coordinatePair(url.searchParams.get(key));
    if (pair) return resultFromPair([pair[1], pair[0]], url.searchParams.get("whatshere[zoom]") || queryZoom(url));
  }
  return null;
}

function parseApple(url) {
  for (const key of ["coordinate", "center", "ll", "sll"]) {
    const pair = coordinatePair(url.searchParams.get(key));
    if (pair) return resultFromPair(pair, queryZoom(url));
  }
  return null;
}

function parse2gis(url) {
  const map = decodeRepeated(url.searchParams.get("m") || "");
  const mapMatch = /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?/.exec(map);
  if (mapMatch) return resultFromPair([mapMatch[2], mapMatch[1]], mapMatch[3]);

  const center = coordinatePair(url.searchParams.get("center") || url.searchParams.get("c"));
  if (center) return resultFromPair([center[1], center[0]], queryZoom(url));

  const pathMatch = /\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\/|$)/.exec(decodeRepeated(url.pathname));
  return pathMatch ? resultFromPair([pathMatch[2], pathMatch[1]], queryZoom(url)) : null;
}

function parseTelegram(url) {
  if (url.protocol === "geo:") {
    const queryPair = coordinatePair(url.searchParams.get("q"));
    if (queryPair) return resultFromPair(queryPair, queryZoom(url));
    const pair = coordinatePair(url.pathname);
    if (pair) return resultFromPair(pair, queryZoom(url));
  }

  const latitude = url.searchParams.get("latitude") ?? url.searchParams.get("lat");
  const longitude = url.searchParams.get("longitude") ?? url.searchParams.get("lon") ?? url.searchParams.get("lng");
  if (latitude != null && longitude != null) return resultFromPair([latitude, longitude], queryZoom(url));
  for (const key of ["q", "ll", "location", "coordinates"]) {
    const pair = coordinatePair(url.searchParams.get(key));
    if (pair) return resultFromPair(pair, queryZoom(url));
  }
  return null;
}

function resultFromPair(pair, zoom = null) {
  const latitude = Number(pair?.[0]);
  const longitude = Number(pair?.[1]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return {
    location: { latitude, longitude },
    ...(zoom !== null && zoom !== "" && Number.isFinite(Number(zoom)) ? { zoom: Number(zoom) } : {})
  };
}

function coordinatePair(value) {
  const match = /(-?\d+(?:\.\d+)?)\s*(?:,|\s|\+)\s*([+-]?\d+(?:\.\d+)?)/.exec(decodeRepeated(value || ""));
  return match ? [match[1], match[2]] : null;
}

function queryZoom(url) {
  return url.searchParams.get("zoom") ?? url.searchParams.get("z");
}

function providerFor(url) {
  const host = url.hostname.toLowerCase();
  if (url.protocol === "geo:" || url.protocol === "tg:" || isTelegramHost(host)) return "telegram";
  if (host === "maps.app.goo.gl" || host === "goo.gl" || /(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (isYandexHost(host)) return "yandex";
  if (host === "maps.apple.com" || host === "maps.apple" || host.endsWith(".maps.apple")) return "apple";
  if (/(^|\.)2gis\.[a-z.]+$/.test(host)) return "2gis";
  return "";
}

function isYandexHost(host) {
  return /(^|\.)yandex\.[a-z.]+$/.test(host);
}

function isTelegramHost(host) {
  return ["t.me", "telegram.me", "telegram.dog"].includes(host) || host.endsWith(".t.me");
}

function parseUrl(value) {
  try {
    if (/^geo:/i.test(value)) return new URL(value);
    if (/^tg:/i.test(value)) return new URL(value);
    return new URL(value);
  } catch { return null; }
}

function decodeRepeated(value) {
  let result = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch { break; }
  }
  return result;
}
