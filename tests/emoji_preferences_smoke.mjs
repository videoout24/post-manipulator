import assert from "node:assert/strict";
import { EmojiPreferences, EMOJI_PREFERENCES_KEY } from "../js/editor/EmojiPreferences.js?v=1.7.9";

const writes = [];
const preferences = new EmojiPreferences({
  db: {
    async get(store, key) {
      assert.equal(store, "settings");
      assert.equal(key, EMOJI_PREFERENCES_KEY);
      return { promoted: ["🚀", "missing", "😀", "🚀"] };
    },
    async put(store, key, value) { writes.push([store, key, structuredClone(value)]); }
  }
});

await preferences.initialize();
assert.deepEqual(preferences.orderedCatalog(["😀", "🚀", "✅"]), ["🚀", "😀", "✅"]);

await preferences.promote("✅");
assert.deepEqual(preferences.orderedCatalog(["😀", "🚀", "✅"]), ["✅", "🚀", "😀"]);
assert.deepEqual(writes, [["settings", EMOJI_PREFERENCES_KEY, { promoted: ["✅", "🚀", "😀"] }]]);

await preferences.promote("🚀");
assert.deepEqual(preferences.orderedCatalog(["😀", "🚀", "✅"]), ["🚀", "✅", "😀"]);

console.log("emoji_preferences_smoke: OK");
