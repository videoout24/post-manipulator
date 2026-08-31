import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { AppNotifications } from "../js/app/AppNotifications.js?v=1.5.9";

const classes = new Set();
const root = {
  textContent: "",
  dataset: {},
  classList: {
    add: name => classes.add(name),
    remove: name => classes.delete(name)
  }
};
const events = new EventBus();
let lastShown = null;
events.on("ui:notification-shown", payload => { lastShown = payload; });
let scheduled = null;
let scheduledDelay = 0;
let cleared = null;
const notifications = new AppNotifications({
  root,
  events,
  setTimer: (callback, delay) => { scheduled = callback; scheduledDelay = delay; return 7; },
  clearTimer: timer => { cleared = timer; }
}).start();

events.emit("ui:toast", { message: "Готово", type: "success", duration: 50 });
assert.equal(root.textContent, "Готово");
assert.equal(root.dataset.type, "success");
assert.deepEqual(lastShown, { message: "Готово", type: "success" });
assert(classes.has("visible"));
assert.equal(scheduledDelay, 1200, "toast duration must respect the minimum visibility time");

scheduled();
assert(!classes.has("visible"));

events.emit("ui:editor-notice", { message: "Тихий статус", type: "info" });
assert.equal(lastShown.message, "Тихий статус");
assert(!classes.has("visible"), "Editor notices must not open the global toast");

events.emit("telegram:runtime-status", { state: "retrying" });
assert.equal(root.dataset.type, "warning");
assert.equal(root.textContent, "Telegram: повтор подключения…");
const firstRuntimeMessage = root.textContent;
events.emit("telegram:runtime-status", { state: "retrying", message: "duplicate" });
assert.equal(root.textContent, firstRuntimeMessage, "identical runtime states must be deduplicated");

events.emit("gallery:ingested", { type: "photo", caption: "Обложка" });
assert.equal(root.textContent, "Фото проиндексировано: Обложка");
assert.equal(root.dataset.type, "success");

events.emit("gallery:source-delete-error", { error: new Error("нет прав") });
assert.match(root.textContent, /исходное сообщение не удалено: нет прав/);
assert.equal(root.dataset.type, "warning");

events.emit("project:graph-error", { message: "broken edge" });
assert.equal(root.textContent, "Project graph: broken edge");
assert.equal(root.dataset.type, "error");

notifications.stop();
assert.equal(cleared, 7);

let receiverChecked = false;
function browserStyleSetTimer() {
  assert.equal(this, globalThis, "native timer wrapper must use the global receiver");
  receiverChecked = true;
  return 9;
}
function browserStyleClearTimer() {
  assert.equal(this, globalThis, "native clearTimer wrapper must use the global receiver");
}
const receiverSafeNotifications = new AppNotifications({
  root,
  setTimer: browserStyleSetTimer,
  clearTimer: browserStyleClearTimer
});
receiverSafeNotifications.show("receiver-safe");
receiverSafeNotifications.stop();
assert(receiverChecked);

const inlineClasses = new Set();
const inlineRoot = {
  textContent: "",
  dataset: {},
  classList: { add: name => inlineClasses.add(name), remove: name => inlineClasses.delete(name) }
};
const inlineNotifications = new AppNotifications({ root: inlineRoot, events, inlineWhen: () => true });
inlineNotifications.show({ message: "Только строка", type: "warning" });
assert.equal(lastShown.message, "Только строка");
assert(!inlineClasses.has("visible"), "Active Editor must suppress every global toast");

console.log("app_notifications_smoke: OK");
