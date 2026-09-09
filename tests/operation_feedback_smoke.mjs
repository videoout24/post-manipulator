import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { OperationFeedback } from "../js/app/OperationFeedback.js";
import { TelegramClient } from "../js/telegram/TelegramClient.js";

const events = new EventBus();
const timers = new Map(); let timerId = 0;
const feedback = new OperationFeedback({ events, documentRoot: null,
  setTimer(fn) { timers.set(++timerId, fn); return timerId; },
  clearTimer(id) { timers.delete(id); }
}).start();
const finishTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
let release;
const client = new TelegramClient({ token: "test-token", events, scheduler: { schedule(operation) {
  return new Promise(resolve => { release = () => resolve(operation()); });
} } });
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: {} }) });
  const waiting = client.sendRichMessage({ chatId: 1, richMessage: {} });
  assert.equal(feedback.snapshot().active, true, "queued requests must already show progress");
  assert.equal(feedback.snapshot().requestCount, 1);
  await client.getMe();
  assert.equal(feedback.snapshot().requestCount, 1, "finishing one request must not hide another");
  release(); await waiting;
  assert.equal(feedback.snapshot().active, false);
  finishTimers();
  assert.equal(feedback.snapshot().visible, false);
  await client.getUpdates({ timeout: 0 });
  assert.equal(feedback.snapshot().visible, false, "long polling must not show the foreground indicator");

  const file = new Blob(["photo"], { type: "image/png" });
  Object.defineProperty(file, "name", { value: "photo.png" });
  const upload = client.uploadMedia({ chatId: 1, file });
  assert.equal(feedback.snapshot().detail, "photo.png");
  globalThis.fetch = async () => { throw new Error("offline"); };
  release(); await assert.rejects(upload);
  assert.equal(feedback.snapshot().active, false, "network failure must stop the spinner");
  finishTimers();

  events.emit("gallery:upload-progress", { uploadId: 1, state: "uploading", current: 1, total: 2, fileName: "a.png" });
  assert.equal(feedback.snapshot().current, 0, "an in-flight file must not count as completed");
  events.emit("telegram:operation-start", { id: 99, method: "sendPhoto" });
  events.emit("telegram:operation-end", { id: 99, method: "sendPhoto" });
  assert.equal(feedback.snapshot().active, true, "batch progress must bridge gaps between requests");
  events.emit("gallery:upload-progress", { uploadId: 1, state: "uploading", current: 2, total: 2, fileName: "b.png" });
  assert.equal(feedback.snapshot().current, 1);
  events.emit("gallery:upload-progress", { uploadId: 1, state: "partial", total: 2, assets: [{}], failures: [{}] });
  assert.equal(feedback.snapshot().active, false);
  assert.equal(feedback.snapshot().total, 2);
  assert.ok(feedback.snapshot().detail.includes("1"));
  finishTimers();
  assert.equal(feedback.snapshot().visible, false);

  events.emit("project:publication", { projectId: "p", state: "publishing", total: 4, current: 0 });
  events.emit("project:publication", { projectId: "p", state: "resolving", total: 4, current: 2 });
  assert.equal(feedback.snapshot().current, 2);
  events.emit("project:publication", { projectId: "p", state: "partial" });
  assert.equal(feedback.snapshot().active, false);
  events.emit("project:publication", { projectId: "p", state: "updating", total: 4, current: 0 });
  events.emit("project:publication-phase-ended", { projectId: "p" });
  assert.equal(feedback.snapshot().active, false, "failed update phases must not leave a stuck indicator");
  feedback.stop();
  assert.equal(timers.size, 0);
} finally {
  globalThis.fetch = originalFetch;
  feedback.stop();
}
console.log("operation_feedback_smoke: OK");
