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
await preferences.setAutoCollapseInactive(true);
assert.deepEqual(writes, [["settings", "editor.canvas.preferences", { autoCollapseInactive: true }]]);

console.log("editor_canvas_preferences_smoke: OK");
