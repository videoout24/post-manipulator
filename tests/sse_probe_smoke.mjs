import assert from "node:assert/strict";
import { SseProbe, normalizeBaseUrl } from "../js/network/SseProbe.js?v=1.7.19";

const values = new Map();
const emitted = [];
const requests = [];
const sources = [];
const probe = new SseProbe({
  db: {
    async get(store, key, fallback = null) { return values.get(`${store}:${key}`) ?? fallback; },
    async put(store, key, value) { values.set(`${store}:${key}`, value); }
  },
  events: { emit(name, payload) { emitted.push([name, payload]); } },
  eventSourceFactory(url) {
    const source = { url, closed: false, close() { this.closed = true; } };
    sources.push(source);
    return source;
  },
  async fetchFn(url, options) {
    requests.push([url, options]);
    return { ok: true, status: 200, async text() { return JSON.stringify({ delivered: true }); } };
  }
});

assert.equal(normalizeBaseUrl(" https://node.example/ "), "https://node.example");
assert.throws(() => normalizeBaseUrl("node.example"), /absolute URL/);
assert.throws(() => normalizeBaseUrl("ftp://node.example"), /HTTP or HTTPS/);

await probe.initialize();
await probe.connect("https://node.example/");
assert.equal(values.get("settings:sseBaseUrl"), "https://node.example");
assert.equal(sources[0].url, "https://node.example/events");
assert.equal(probe.getState().connection, "connecting");

sources[0].onopen();
assert.equal(probe.getState().connection, "open");
sources[0].onmessage({ data: "hello from SSE" });
assert.equal(probe.getState().lastEvent, "hello from SSE");

const result = await probe.pushTest();
assert.deepEqual(result, { delivered: true });
assert.equal(requests[0][0], "https://node.example/api/push");
assert.equal(requests[0][1].method, "POST");
assert.deepEqual(requests[0][1].headers, { "Content-Type": "application/json" });
assert.deepEqual(JSON.parse(requests[0][1].body), { text: "GitHub Pages → Tailscale → SSE" });

probe.stop();
assert.equal(sources[0].closed, true);
assert(emitted.every(([name]) => name === "network:sse-probe"));

console.log("sse_probe_smoke: OK");
