import assert from "node:assert/strict";
import {
  MapLinkError,
  isShortMapLink,
  mapDimensions,
  mapOrientation,
  normalizeMapZoom,
  resolveMapLink
} from "../js/core/MapLinkResolver.js?v=1.11.0";

const cases = [
  [
    "https://www.google.com/maps/@37.799294,-122.397611,15z",
    "google", 37.799294, -122.397611, 15
  ],
  [
    "https://www.google.com/maps/search/?api=1&query=47.5951518%2C-122.3316393",
    "google", 47.5951518, -122.3316393, undefined
  ],
  [
    "https://yandex.ru/maps/?whatshere%5Bpoint%5D=37.617635%2C55.755814&whatshere%5Bzoom%5D=18",
    "yandex", 55.755814, 37.617635, 18
  ],
  [
    "https://maps.apple.com/place?coordinate=46.850646,9.523970&name=VA%20BENE",
    "apple", 46.850646, 9.52397, undefined
  ],
  [
    "https://maps.apple.com/frame?center=40.753035,-73.981846",
    "apple", 40.753035, -73.981846, undefined
  ],
  [
    "https://2gis.ru/odintsovo/firm/70000001083503220/37.293991%2C55.68369?m=37.293991%2C55.68369%2F16",
    "2gis", 55.68369, 37.293991, 16
  ],
  [
    "geo:13.7563,100.5018?z=14",
    "telegram", 13.7563, 100.5018, 14
  ],
  [
    "geo:0,0?q=59.9386,30.3141&z=13",
    "telegram", 59.9386, 30.3141, 13
  ],
  [
    "tg://location?latitude=59.9386&longitude=30.3141&zoom=13",
    "telegram", 59.9386, 30.3141, 13
  ],
  [
    "https://t.me/share/url?url=geo%3A48.8566%2C2.3522%3Fz%3D11",
    "telegram", 48.8566, 2.3522, 11
  ]
];

for (const [url, provider, latitude, longitude, zoom] of cases) {
  const resolved = resolveMapLink(url);
  assert.equal(resolved.provider, provider, url);
  assert.equal(resolved.location.latitude, latitude, url);
  assert.equal(resolved.location.longitude, longitude, url);
  assert.equal(resolved.zoom, zoom, url);
}

for (const short of [
  "https://maps.app.goo.gl/wsmXZrYfP8V3ur2RA",
  "https://yandex.ru/maps/-/CCUkr2Hj3A",
  "https://maps.apple/p/JEhZEbi5cV5ISR",
  "https://go.2gis.com/example"
]) {
  assert.equal(isShortMapLink(short), true);
  assert.throws(() => resolveMapLink(short), error => error instanceof MapLinkError && error.code === "short");
}

assert.throws(
  () => resolveMapLink("https://example.com/?q=55.75,37.61"),
  error => error instanceof MapLinkError && error.code === "unsupported"
);
assert.throws(
  () => resolveMapLink("https://maps.google.com/?q=coffee"),
  error => error instanceof MapLinkError && error.code === "coordinates"
);
assert.equal(normalizeMapZoom(0), 1);
assert.equal(normalizeMapZoom(21), 20);
assert.equal(normalizeMapZoom(12.6), 13);
assert.equal(mapOrientation({ width: 320, height: 640 }), "portrait");
assert.equal(mapOrientation({ width: 640, height: 320 }), "landscape");
assert.deepEqual(mapDimensions("portrait"), { width: 320, height: 640 });
assert.deepEqual(mapDimensions("landscape"), { width: 640, height: 320 });

console.log("map_link_resolver_smoke: OK");
