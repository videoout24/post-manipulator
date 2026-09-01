import { AVAILABLE_EMOJIS } from "./EmojiCatalog.js?v=1.7.6";

const SETTINGS_KEY = "editor.emoji.preferences";
const AVAILABLE_EMOJI_SET = new Set(AVAILABLE_EMOJIS);

/** Per-bot ordering overrides for the built-in emoji catalog. */
export class EmojiPreferences {
  constructor({ db, events = null } = {}) {
    this.db = db;
    this.events = events;
    this.promoted = [];
    this.initialized = false;
    this.saveQueue = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return this.snapshot();
    const saved = await this.db?.get?.("settings", SETTINGS_KEY, null);
    const values = Array.isArray(saved?.promoted) ? saved.promoted : [];
    this.promoted = [...new Set(values.filter(value => AVAILABLE_EMOJI_SET.has(value)))];
    this.initialized = true;
    return this.snapshot();
  }

  snapshot() { return { promoted: [...this.promoted] }; }

  orderedCatalog(catalog = []) {
    const available = new Set(catalog);
    const promoted = this.promoted.filter(value => available.has(value));
    const promotedSet = new Set(promoted);
    return [...promoted, ...catalog.filter(value => !promotedSet.has(value))];
  }

  async promote(value) {
    if (!this.initialized) await this.initialize();
    const emoji = String(value || "");
    if (!AVAILABLE_EMOJI_SET.has(emoji)) return this.snapshot();
    this.promoted = [emoji, ...this.promoted.filter(item => item !== emoji)];
    const snapshot = this.snapshot();
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => this.db?.put?.("settings", SETTINGS_KEY, snapshot));
    await this.saveQueue;
    this.events?.emit?.("editor:emoji-preferences-changed", snapshot);
    return snapshot;
  }
}

export { SETTINGS_KEY as EMOJI_PREFERENCES_KEY };
