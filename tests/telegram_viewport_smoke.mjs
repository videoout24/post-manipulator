import assert from "node:assert/strict";
import { TelegramViewportController } from "../js/telegram/TelegramViewportController.js?v=1.7.5";

const css = new Map();
const webAppListeners = new Map();
const windowListeners = new Map();
const visualListeners = new Map();
let expanded = 0;
const webApp = {
  platform: "tdesktop",
  viewportStableHeight: 720,
  expand() { expanded += 1; },
  onEvent(name, handler) { webAppListeners.set(name, handler); },
  offEvent(name, handler) { if (webAppListeners.get(name) === handler) webAppListeners.delete(name); }
};
const visualViewport = {
  width: 1000,
  height: 700,
  addEventListener(name, handler) { visualListeners.set(name, handler); },
  removeEventListener(name, handler) { if (visualListeners.get(name) === handler) visualListeners.delete(name); }
};
const windowRoot = {
  innerWidth: 1000,
  innerHeight: 700,
  screen: { availWidth: 1920, availHeight: 1040 },
  visualViewport,
  addEventListener(name, handler) { windowListeners.set(name, handler); },
  removeEventListener(name, handler) { if (windowListeners.get(name) === handler) windowListeners.delete(name); }
};
const documentRoot = {
  body: { dataset: {} },
  documentElement: {
    clientWidth: 1000,
    clientHeight: 700,
    style: { setProperty: (key, value) => css.set(key, value) }
  }
};

const controller = new TelegramViewportController({ webApp, windowRoot, documentRoot });
const initial = controller.start();
assert.equal(expanded, 0, "Telegram window size must remain under user and client control");
assert.equal(initial.viewportWidth, 1000);
assert.equal(initial.viewportHeight, 720);
assert.equal(initial.preferredWidth, 1280, "two-thirds width is diagnostic because Telegram owns the native window");
assert.equal(initial.widthManagedByTelegram, true);
assert.equal(css.get("--app-viewport-height"), "720px");
assert.equal(css.get("--editor-bottom-spacer-height"), "360px");
assert.equal(css.get("--app-preferred-window-width"), "1280px");
assert.equal(documentRoot.body.dataset.telegramPlatform, "tdesktop");

visualViewport.width = 900;
webApp.viewportStableHeight = 760;
webAppListeners.get("viewportChanged")();
assert.equal(controller.snapshot.viewportWidth, 900);
assert.equal(controller.snapshot.viewportHeight, 760);
assert.equal(css.get("--app-viewport-width"), "900px");
assert.equal(css.get("--editor-bottom-spacer-height"), "380px");

controller.start();
assert.equal(expanded, 0, "starting twice must not request expansion");
controller.stop();
assert.equal(webAppListeners.size, 0);
assert.equal(windowListeners.size, 0);
assert.equal(visualListeners.size, 0);

console.log("telegram_viewport_smoke: OK");
