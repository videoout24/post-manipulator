import assert from "node:assert/strict";
import { LayoutPreferences, layoutForViewport } from "../js/core/LayoutPreferences.js?v=1.7.4";

assert.deepEqual(layoutForViewport(900), {
  editorLeft: 162,
  editorProject: 210,
  galleryLeft: 153,
  galleryRight: 250,
  projectLibraryLeft: 180,
  projectLibraryRight: 260,
  publicationsLeft: 220,
  publicationsRight: 260
});

const css = new Map();
const events = [];
let databaseReads = 0;
let databaseWrites = 0;
let storedLayout = {
  version: 1,
  tabs: {
    editor: { editorLeft: 0.2, editorProject: 0.22 },
    gallery: { galleryLeft: 0.17, galleryRight: 0.3 },
    project: { projectLibraryLeft: 0.2, projectLibraryRight: 0.27 },
    publications: { publicationsLeft: 0.23, publicationsRight: 0.27 }
  }
};
const resizeListeners = new Set();
const windowRoot = {
  innerWidth: 900,
  addEventListener(name, listener) { if (name === "resize") resizeListeners.add(listener); },
  removeEventListener(name, listener) { if (name === "resize") resizeListeners.delete(listener); }
};
const preferences = new LayoutPreferences({
  db: {
    async get(store, key) {
      databaseReads += 1;
      assert.equal(store, "settings");
      assert.equal(key, "ui.layout.preferences");
      return storedLayout;
    },
    async put(store, key, value) {
      databaseWrites += 1;
      assert.equal(store, "settings");
      assert.equal(key, "ui.layout.preferences");
      storedLayout = value;
    }
  },
  events: { emit: (name, value) => events.push([name, value]) },
  windowRoot,
  documentRoot: {
    documentElement: {
      clientWidth: 900,
      style: { setProperty: (key, value) => css.set(key, value) }
    }
  }
});

const initialized = await preferences.initialize();
assert.equal(databaseReads, 1);
assert.equal(initialized.editorLeft, 180);
assert.equal(initialized.galleryRight, 270);
assert.equal(css.get("--gallery-right-width"), "270px");

preferences.setLocal("galleryRight", 252);
await preferences.save();
assert.equal(databaseWrites, 1);
assert.equal(storedLayout.version, 1);
assert.equal(storedLayout.tabs.gallery.galleryRight, 0.28);
assert.equal(storedLayout.tabs.editor.editorLeft, 0.2, "saving Gallery must preserve the Editor ratio");
assert.equal(css.get("--gallery-right-width"), "252px");
assert.equal(events.at(-1)[0], "layout:changed");

windowRoot.innerWidth = 1200;
for (const listener of resizeListeners) listener();
assert.equal(preferences.get("editorLeft"), 240);
assert.equal(preferences.get("galleryRight"), 336, "a resized viewport must restore the saved ratio");
assert.equal(css.get("--gallery-right-width"), "336px");
assert.equal(databaseWrites, 1, "viewport changes must not rewrite the preference");

preferences.stop();
assert.equal(resizeListeners.size, 0);

console.log("layout_preferences_viewport_smoke: OK");
