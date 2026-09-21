import assert from "node:assert/strict";
import {
  MapLinkError,
  mapDimensions,
  mapOrientation,
  normalizeMapZoom,
  resolveMapLink
} from "../js/core/MapLinkResolver.js?v=1.11.3";

const cases = [
  [
    "https://www.google.com/maps/@37.799294,-122.397611,15z",
    37.799294, -122.397611
  ],
  [
    "https://www.google.com/maps/search/?api=1&query=47.5951518%2C-122.3316393",
    47.5951518, -122.3316393
  ],
  [
    "https://maps.apple.com/place?coordinate=46.850646,9.523970&name=VA%20BENE",
    46.850646, 9.52397
  ],
  [
    "https://maps.apple.com/frame?center=40.753035,-73.981846",
    40.753035, -73.981846
  ],
  [
    "geo:13.7563,100.5018?z=14",
    13.7563, 100.5018
  ],
  [
    "geo:0,0?q=59.9386,30.3141&z=13",
    59.9386, 30.3141
  ],
  [
    "tg://location?latitude=59.9386&longitude=30.3141&zoom=13",
    59.9386, 30.3141
  ],
  [
    "https://t.me/share/url?url=geo%3A48.8566%2C2.3522%3Fz%3D11",
    48.8566, 2.3522
  ]
];

for (const [url, latitude, longitude] of cases) {
  const resolved = resolveMapLink(url);
  assert.equal(resolved.location.latitude, latitude, url);
  assert.equal(resolved.location.longitude, longitude, url);
}

const coordinateCases = [
  ["вфыв11.4622109,104.9536969", 11.4622109, 104.9536969],
  ["вфыв104.9536969,11.4622109", 11.4622109, 104.9536969],
  ["https://maps.unknown.example/place/11.4622109,104.9536969,15z", 11.4622109, 104.9536969],
  ["https://maps.unknown.example/place/104.9536969;11.4622109", 11.4622109, 104.9536969],
  ["55.755814; 37.617635", 55.755814, 37.617635],
  ["longitude = 37.617635 | latitude = 55.755814", 55.755814, 37.617635],
  ["longitude 100,5018 / latitude 13,7563", 13.7563, 100.5018],
  ["74.0060° W :: 40.7128° N", 40.7128, -74.006]
];

for (const [source, latitude, longitude] of coordinateCases) {
  const resolved = resolveMapLink(source);
  assert.equal(resolved.location.latitude, latitude, source);
  assert.equal(resolved.location.longitude, longitude, source);
}

for (const short of [
  "https://maps.app.goo.gl/wsmXZrYfP8V3ur2RA",
  "https://yandex.ru/maps/-/CCUkr2Hj3A",
  "https://maps.apple/p/JEhZEbi5cV5ISR",
  "https://go.2gis.com/example"
]) {
  assert.throws(() => resolveMapLink(short), error => error instanceof MapLinkError && error.code === "coordinates");
}

assert.deepEqual(resolveMapLink("https://example.com/?q=55.75,37.61").location, {
  latitude: 55.75,
  longitude: 37.61
});
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
