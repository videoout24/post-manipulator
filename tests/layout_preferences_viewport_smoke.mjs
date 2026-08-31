import assert from "node:assert/strict";
import { LayoutPreferences, layoutForViewport } from "../js/core/LayoutPreferences.js?v=1.7.3";

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
const preferences = new LayoutPreferences({
  db: {
    async get() { databaseReads += 1; return { galleryRight: 620 }; },
    async put() { databaseWrites += 1; }
  },
  events: { emit: (name, value) => events.push([name, value]) },
  windowRoot: { innerWidth: 900 },
  documentRoot: {
    documentElement: {
      clientWidth: 900,
      style: { setProperty: (key, value) => css.set(key, value) }
    }
  }
});

const initialized = await preferences.initialize();
assert.equal(databaseReads, 0, "saved panel widths must not be loaded across displays");
assert.equal(initialized.galleryRight, 250);
assert.equal(css.get("--gallery-right-width"), "250px");

preferences.setLocal("galleryRight", 420);
await preferences.save();
assert.equal(databaseWrites, 0, "manual splitter width must remain session-only");
assert.equal(css.get("--gallery-right-width"), "420px");
assert.equal(events.at(-1)[0], "layout:changed");

console.log("layout_preferences_viewport_smoke: OK");
