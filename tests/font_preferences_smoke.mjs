import assert from "node:assert/strict";
import {
  FONT_SIZE_PREFERENCE_KEY,
  FontPreferences
} from "../js/core/FontPreferences.js";

const stored = new Map([
  [FONT_SIZE_PREFERENCE_KEY, JSON.stringify({ 8: 4, 12: 15.5, 999: 40 })]
]);
const storage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: key => stored.delete(key)
};
const listeners = new Map();
const windowRoot = {
  localStorage: storage,
  addEventListener: (name, listener) => listeners.set(name, listener),
  removeEventListener: (name, listener) => {
    if (listeners.get(name) === listener) listeners.delete(name);
  }
};
const properties = new Map();
const documentRoot = {
  documentElement: {
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name)
    }
  }
};

const preferences = new FontPreferences({ windowRoot, documentRoot }).start();
assert.equal(preferences.getValue(12), 15.5, "saved sizes must be restored");
assert.equal(preferences.getValue(8), 8, "out-of-range sizes must be ignored");
assert.equal(properties.get("--font-size-12"), "15.5px", "saved sizes must become root CSS variables");
assert.equal(properties.has("--font-size-8"), false);

let notifications = 0;
const unsubscribe = preferences.subscribe(() => { notifications += 1; });
assert.equal(preferences.setValue(8, 10), true);
assert.equal(properties.get("--font-size-8"), "10px");
assert.equal(JSON.parse(stored.get(FONT_SIZE_PREFERENCE_KEY))[8], 10, "changes must persist");
assert.equal(preferences.setValue(8, 120), false, "out-of-range edits must be rejected");
assert.equal(preferences.setValue(999, 20), false, "unknown tokens must be rejected");

listeners.get("storage")?.({
  key: FONT_SIZE_PREFERENCE_KEY,
  newValue: JSON.stringify({ 9: 11 }),
  storageArea: storage
});
assert.equal(preferences.getValue(9), 11, "storage changes from another page must be applied");
assert.equal(properties.get("--font-size-9"), "11px");
assert.equal(properties.has("--font-size-12"), false, "removed overrides must fall back to CSS defaults");

preferences.reset();
assert.equal(preferences.hasCustomizations(), false);
assert.equal(stored.has(FONT_SIZE_PREFERENCE_KEY), false);
assert.equal(properties.size, 0, "reset must restore the central CSS scale");
assert(notifications >= 3);
unsubscribe();
preferences.stop();
assert.equal(listeners.has("storage"), false);

console.log("font preferences smoke: OK");
