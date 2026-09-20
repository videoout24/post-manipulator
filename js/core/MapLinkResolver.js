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
  const source = String(value || "").trim();
  if (!source) throw new MapLinkError("empty");
  const location = parseCoordinateLocation(source);
  if (!location) throw new MapLinkError("coordinates");
  return { sourceUrl: source, location };
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

function parseCoordinateLocation(source) {
  const text = decodeRepeated(source).trim();
  const labeledLatitude = labeledCoordinate(text, ["latitude", "lat"]);
  const labeledLongitude = labeledCoordinate(text, ["longitude", "lng", "lon"]);
  if (labeledLatitude != null || labeledLongitude != null) {
    return validLocation(labeledLatitude, labeledLongitude);
  }

  const directional = [...text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])\b/giu)];
  if (directional.length) {
    let latitude = null;
    let longitude = null;
    for (const match of directional) {
      const direction = match[2].toUpperCase();
      const absolute = Math.abs(decimalCoordinate(match[1]));
      if (direction === "N" || direction === "S") latitude = direction === "S" ? -absolute : absolute;
      if (direction === "E" || direction === "W") longitude = direction === "W" ? -absolute : absolute;
    }
    return validLocation(latitude, longitude);
  }

  const integerPair = /^\s*([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})\s*$/.exec(text);
  if (integerPair) return orderedLocation(Number(integerPair[1]), Number(integerPair[2]));

  const matches = [...text.matchAll(/[+-]?\d+(?:[.,]\d+)?/g)];
  const decimalPairs = adjacentCoordinatePairs(matches).filter(([first, second]) =>
    /[.,]/.test(first[0]) && /[.,]/.test(second[0])
  );
  const directlySeparated = decimalPairs.filter(([first, second]) => {
    const gap = text.slice(first.index + first[0].length, second.index);
    return gap.length <= 24 && !/[\p{L}\d]/u.test(gap);
  });
  return firstOrderedLocation(directlySeparated) || firstOrderedLocation(decimalPairs);
}

function adjacentCoordinatePairs(matches) {
  const pairs = [];
  for (let index = 0; index < matches.length - 1; index += 1) {
    pairs.push([matches[index], matches[index + 1]]);
  }
  return pairs;
}

function firstOrderedLocation(pairs) {
  let ambiguous = null;
  for (const [firstMatch, secondMatch] of pairs) {
    const first = decimalCoordinate(firstMatch[0]);
    const second = decimalCoordinate(secondMatch[0]);
    const forward = validLocation(first, second);
    const reverse = validLocation(second, first);
    if (forward && !reverse) return forward;
    if (reverse && !forward) return reverse;
    ambiguous ||= forward || reverse;
  }
  return ambiguous;
}

function orderedLocation(first, second) {
  return validLocation(first, second) || validLocation(second, first);
}

function labeledCoordinate(text, labels) {
  const alternatives = labels.join("|");
  const number = "([+-]?\\d+(?:[.,]\\d+)?)";
  const label = `(?:${alternatives})`;
  const after = new RegExp(`(?:^|[^\\p{L}])${label}(?=$|[^\\p{L}])[^+\\-\\d]{0,16}${number}`, "iu").exec(text);
  if (after) return decimalCoordinate(after[1]);
  const before = new RegExp(`${number}[^\\p{L}\\d]{0,16}${label}(?=$|[^\\p{L}])`, "iu").exec(text);
  return before ? decimalCoordinate(before[1]) : null;
}

function decimalCoordinate(value) {
  return Number(String(value).replace(",", "."));
}

function validLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
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
