import assert from "node:assert/strict";
import { AppLifecycle } from "../js/app/AppLifecycle.js?v=1.5.9";

const calls = [];
const notices = [];
const galleryRoot = { innerHTML: "" };
const splitters = new Map([
  ["#editorLeftSplitter", { id: "left" }],
  ["#editorProjectSplitter", { id: "right" }],
  ["#projectLibrarySplitter", { id: "library" }],
  ["#projectLibraryPostSplitter", { id: "library-post" }],
  ["#galleryApp", galleryRoot]
]);
const documentRoot = { querySelector: selector => splitters.get(selector) || null };
const listeners = new Map();
const windowRoot = {
  addEventListener: (name, handler) => listeners.set(name, handler),
  removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); }
};
const service = name => ({ async initialize() { calls.push(`${name}:initialize`); } });
const layoutPreferences = {
  async initialize() { calls.push("layout:initialize"); },
  bindSplitter(_root, options) { calls.push(`splitter:${options.key}`); }
};
const galleryCore = { start() { calls.push("gallery-core:start"); } };
const galleryView = { async initialize() { calls.push("gallery:initialize"); throw new Error("<gallery & failed>"); } };
const telegramRuntime = {
  running: false,
  getStatus() { return { running: this.running }; },
  async start() { calls.push("runtime:start"); this.running = true; },
  stop() { calls.push("runtime:stop"); }
};
const telegramClient = {
  token: "",
  hasToken() { return Boolean(this.token); },
  setToken(value) { calls.push("client:set-token"); this.token = value; }
};
const projectSession = {
  async initialize() { calls.push("project:initialize"); },
  async flush() { calls.push("project:flush"); }
};
const stopped = { stop: () => calls.push("service:stop") };
const lifecycle = new AppLifecycle({
  windowRoot,
  documentRoot,
  build: "1.5.9",
  notifications: { show: payload => notices.push(payload) },
  layoutPreferences,
  telegramNavigation: service("navigation"),
  projectSession,
  editorTelegramControls: service("telegram-controls"),
  projectLibrary: service("project-library"),
  galleryCore,
  telegramSettings: service("telegram-settings"),
  publicationView: service("publications"),
  publicationService: service("draft-schedules"),
  galleryView,
  appDb: { async get(_store, _key, fallback = null) { return fallback; } },
  ownerBinding: { async getOwner() { return { id: 1 }; }, async getSession() { return null; } },
  previewChannelBinding: { async getSession() { return null; } },
  telegramRuntime,
  telegramClient,
  telegramCore: { editor: { preview: { async isEnabled() { return false; } } } },
  editorPreviewStatus: { showLivePreviewSetting: enabled => calls.push(["preview:setting", enabled]) },
  stoppables: [stopped],
  logger: { error: () => {} }
});

await lifecycle.start();
assert(calls.indexOf("gallery-core:start") < calls.indexOf("telegram-settings:initialize"));
assert(calls.indexOf("publications:initialize") < calls.indexOf("draft-schedules:initialize"));
assert.equal(calls.filter(call => typeof call === "string" && call.startsWith("splitter:")).length, 4);
assert(calls.includes("splitter:projectLibraryRight"));
assert(!calls.includes("client:set-token"));
assert(!calls.includes("runtime:start"));
assert.deepEqual(calls.at(-1), ["preview:setting", false]);
assert.match(galleryRoot.innerHTML, /&lt;gallery &amp; failed&gt;/);
assert.match(galleryRoot.innerHTML, /build 1\.5\.9/);
assert(notices.some(item => item.message.startsWith("Gallery:")));

listeners.get("beforeunload")();
await Promise.resolve();
assert(calls.includes("service:stop"));
assert(calls.includes("project:flush"));
assert(calls.includes("runtime:stop"));
assert.equal(listeners.size, 0);

console.log("app_lifecycle_smoke: OK");
