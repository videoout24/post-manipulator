import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ThemePreferences, THEME_PREFERENCE_KEY } from "../js/core/ThemePreferences.js";

const earlySource = await readFile(new URL("../js/theme-init.js", import.meta.url), "utf8");

// The synchronous first paint and the long-lived controller must agree for every
// preference/environment combination, including damaged or unavailable storage.
for (const stored of [undefined, "dark", "light", "auto", "invalid"]) {
  for (const telegramTheme of [undefined, "dark", "light", "invalid"]) {
    for (const systemLight of [false, true]) {
      const env = environment({ stored, telegramTheme, systemLight });
      const controller = new ThemePreferences(env);
      vm.runInNewContext(earlySource, { ...env.windowRoot, document: env.documentRoot });
      const earlyTheme = env.documentRoot.documentElement.dataset.theme;
      assert.equal(controller.start().resolve(), earlyTheme);
      const expected = stored === "light" || stored === "dark" ? stored : stored === "auto"
        ? ["dark", "light"].includes(telegramTheme) ? telegramTheme : systemLight ? "light" : "dark"
        : "dark";
      assert.equal(earlyTheme, expected);
      controller.stop();
    }
  }
}

const env = environment({ stored: "auto", telegramTheme: "light" });
const controller = new ThemePreferences(env).start();
assert.equal(env.documentRoot.documentElement.dataset.theme, "light");
assert.deepEqual(env.chromeCalls.slice(-3), [["header", "#ffffff"], ["background", "#f2f5fa"], ["bottom", "#f2f5fa"]]);
controller.start();
assert.equal(env.telegramListeners.size, 1, "starting twice must not add duplicate subscriptions");
env.windowRoot.Telegram.WebApp.colorScheme = "dark";
env.telegramListeners.get("themeChanged")();
assert.equal(env.documentRoot.documentElement.dataset.theme, "dark");
assert.equal(env.select.value, "auto", "resolved theme does not overwrite the selected mode");

controller.setPreference("light");
assert.equal(env.values.get(THEME_PREFERENCE_KEY), "light");
env.telegramListeners.get("themeChanged")();
env.mediaListeners.get("change")();
assert.equal(env.documentRoot.documentElement.dataset.theme, "light", "manual choice overrides environment changes");
assert.equal(new ThemePreferences(env).getPreference(), "light", "choice survives reopening");
assert.equal(env.documentRoot.documentElement.style.colorScheme, "light");

env.listeners.get("storage")({ key: "unrelated", newValue: "dark" });
assert.equal(controller.getPreference(), "light");
env.listeners.get("storage")({ key: THEME_PREFERENCE_KEY, newValue: "dark", storageArea: {} });
assert.equal(controller.getPreference(), "light", "sessionStorage events must not alter local preferences");
env.listeners.get("storage")({ key: THEME_PREFERENCE_KEY, newValue: "dark" });
assert.equal(env.select.value, "dark");
controller.setPreference("light");
env.listeners.get("storage")({ key: null, newValue: null });
assert.equal(controller.getPreference(), "dark", "clearing local settings restores the default");

env.listeners.get("pagehide")({ persisted: true });
env.windowRoot.Telegram.WebApp.colorScheme = "light";
controller.setPreference("auto");
env.listeners.get("pageshow")();
assert.equal(env.documentRoot.documentElement.dataset.theme, "light");
env.listeners.get("pagehide")({ persisted: false });
assert.equal(env.telegramListeners.size, 0);
assert.equal(env.mediaListeners.size, 0);
assert.equal(env.listeners.size, 0);
controller.stop();
controller.start();
assert.equal(env.telegramListeners.size, 1);
controller.stop();

const blocked = environment({ telegramTheme: "light" });
Object.defineProperty(blocked.windowRoot, "localStorage", { get() { throw Error("blocked"); }, configurable: true });
const earlyBlocked = { document: blocked.documentRoot, Telegram: blocked.windowRoot.Telegram };
Object.defineProperty(earlyBlocked, "localStorage", { get() { throw Error("blocked"); } });
vm.runInNewContext(earlySource, earlyBlocked);
assert.equal(blocked.documentRoot.documentElement.dataset.theme, "dark");
const withoutStorage = new ThemePreferences(blocked).start();
assert.equal(withoutStorage.setPreference("light"), "light", "a storage failure must not prevent switching in memory");
assert.equal(withoutStorage.setPreference("invalid"), "dark");
withoutStorage.stop();

const fallback = environment({ stored: "auto", systemLight: false });
const auto = new ThemePreferences(fallback).start();
fallback.mediaQuery.matches = true;
fallback.mediaListeners.get("change")();
assert.equal(auto.resolve(), "light", "auto follows system changes when Telegram is unavailable");
auto.stop();

const oldBridge = environment({ stored: "light", telegramTheme: "dark" });
oldBridge.windowRoot.Telegram.WebApp.isVersionAtLeast = () => false;
new ThemePreferences(oldBridge).start().stop();
assert.equal(oldBridge.chromeCalls.length, 0, "unsupported chrome methods must not be called");
const brokenBridge = environment({ telegramTheme: "light" });
brokenBridge.windowRoot.Telegram.WebApp.onEvent = () => { throw Error("broken bridge"); };
brokenBridge.windowRoot.Telegram.WebApp.setHeaderColor = () => { throw Error("broken bridge"); };
const resilient = new ThemePreferences(brokenBridge).start();
assert.equal(resilient.setPreference("light"), "light");
resilient.stop();

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../js/bootstrap.js", import.meta.url), "utf8");
assert.ok(html.indexOf("theme-init.js") < html.indexOf('rel="stylesheet"'), "theme must be resolved before the stylesheet/first paint");
assert.ok(bootstrap.indexOf("themePreferences.start()") < bootstrap.indexOf("new SecurityGateView"));
assert.match(html, /id="appThemePreference"/);
console.log("theme_preferences_smoke: OK");

function environment({ stored, telegramTheme, systemLight = false } = {}) {
  const values = new Map(stored === undefined ? [] : [[THEME_PREFERENCE_KEY, stored]]);
  const listeners = new Map();
  const telegramListeners = new Map();
  const mediaListeners = new Map();
  const chromeCalls = [];
  const select = { value: "" };
  const header = {};
  const documentRoot = {
    documentElement: { dataset: {}, style: {} },
    querySelector: selector => selector === "#appThemePreference" ? select : selector === ".topbar" ? header : null
  };
  const mediaQuery = {
    matches: systemLight,
    addEventListener: (name, listener) => mediaListeners.set(name, listener),
    removeEventListener: (name, listener) => { assert.equal(mediaListeners.get(name), listener); mediaListeners.delete(name); }
  };
  const windowRoot = {
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    matchMedia: () => mediaQuery,
    addEventListener: (name, listener) => { assert.equal(listeners.has(name), false); listeners.set(name, listener); },
    removeEventListener: (name, listener) => { assert.equal(listeners.get(name), listener); listeners.delete(name); },
    getComputedStyle: node => ({ backgroundColor: node === header ? "rgb(255, 255, 255)" : "rgb(242, 245, 250)" })
  };
  if (telegramTheme !== undefined) windowRoot.Telegram = { WebApp: {
    colorScheme: telegramTheme,
    onEvent: (name, listener) => { assert.equal(telegramListeners.has(name), false); telegramListeners.set(name, listener); },
    offEvent: (name, listener) => { assert.equal(telegramListeners.get(name), listener); telegramListeners.delete(name); },
    isVersionAtLeast: () => true,
    setHeaderColor: color => chromeCalls.push(["header", color]),
    setBackgroundColor: color => chromeCalls.push(["background", color]),
    setBottomBarColor: color => chromeCalls.push(["bottom", color])
  } };
  return { windowRoot, documentRoot, values, select, listeners, telegramListeners, mediaListeners, mediaQuery, chromeCalls };
}
