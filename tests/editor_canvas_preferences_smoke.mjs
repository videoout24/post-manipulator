import assert from "node:assert/strict";
import { EditorCanvasPreferences } from "../js/editor/EditorCanvasPreferences.js?v=1.5.9";

const writes = [];
const preferences = new EditorCanvasPreferences({
  db: {
    async get(store, key) {
      assert.equal(store, "settings");
      assert.equal(key, "editor.canvas.preferences");
      return { autoCollapseInactive: false };
    },
    async put(store, key, value) { writes.push([store, key, value]); }
  }
});

await preferences.initialize();
assert.equal(preferences.autoCollapseInactive, false);
assert.equal(preferences.scrollSpeed, 2, "scrolling defaults to half the former speed");
await preferences.setAutoCollapseInactive(true);
await preferences.setScrollSpeed(0);
assert.deepEqual(writes, [
  ["settings", "editor.canvas.preferences", { autoCollapseInactive: true, scrollSpeed: 2 }],
  ["settings", "editor.canvas.preferences", { autoCollapseInactive: true, scrollSpeed: 0 }]
]);

console.log("editor_canvas_preferences_smoke: OK");
