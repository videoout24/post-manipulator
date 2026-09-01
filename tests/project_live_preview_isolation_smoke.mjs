import assert from "node:assert/strict";
import { PreviewController } from "../js/telegram/PreviewController.js?v=1.7.6";

let projectActive = true;
let releaseChannel;
let waitForChannel = false;
const channelGate = new Promise(resolve => { releaseChannel = resolve; });
const calls = [];
const values = new Map([
  ["settings:livePreviewEnabled", true],
  ["preview:liveMessage", { chatId: -1001, messageId: 7, hash: "old" }]
]);
const controller = new PreviewController({
  db: {
    async get(store, key, fallback = null) { return values.get(`${store}:${key}`) ?? fallback; },
    async put(store, key, value) { values.set(`${store}:${key}`, value); }
  },
  client: {
    hasToken() { return true; },
    async editRichMessage(options) { calls.push(["edit", options]); return { message_id: 7 }; },
    async sendRichMessage(options) { calls.push(["send", options]); return { message_id: 8 }; },
    async pinChatMessage() {}
  },
  previewChannelBinding: {
    async getSlot() {
      if (waitForChannel) await channelGate;
      return { status: "bound", chatId: -1001 };
    }
  },
  renderer: {
    renderEnvelope(tree) { calls.push(["render", tree.kind]); return { richMessage: { text: tree.kind } }; }
  },
  validator: { validate() { return []; } },
  tree: { kind: "standalone" },
  treeProvider: () => ({ kind: projectActive ? "project-map" : "standalone" }),
  syncGuard: () => !projectActive,
  debounceMs: 5
});

const blocked = await controller.sync({ force: true });
assert.equal(blocked.skipped, "guarded");
assert.deepEqual(calls, [], "an active Project must not render or edit live-preview");

projectActive = false;
controller.schedule();
projectActive = true;
await new Promise(resolve => setTimeout(resolve, 20));
assert.deepEqual(calls, [], "a queued standalone timer must be blocked after a Project opens");

projectActive = false;
waitForChannel = true;
const inFlight = controller.sync({ force: true });
await Promise.resolve();
projectActive = true;
releaseChannel();
assert.equal((await inFlight).skipped, "guarded");
assert.deepEqual(calls, [], "a context switch during async preparation must not leak the Project map");

console.log("project_live_preview_isolation_smoke: OK");
