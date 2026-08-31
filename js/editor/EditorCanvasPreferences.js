const SETTINGS_KEY = "editor.canvas.preferences";
const DEFAULTS = Object.freeze({ autoCollapseInactive: true });

// Global editor behaviour only. It deliberately never becomes part of a post AST.
export class EditorCanvasPreferences {
  constructor({ db, events = null } = {}) {
    this.db = db;
    this.events = events;
    this.values = { ...DEFAULTS };
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.snapshot();
    const saved = await this.db?.get?.("settings", SETTINGS_KEY, null);
    if (typeof saved?.autoCollapseInactive === "boolean") {
      this.values.autoCollapseInactive = saved.autoCollapseInactive;
    }
    this.initialized = true;
    return this.snapshot();
  }

  get autoCollapseInactive() { return this.values.autoCollapseInactive; }
  snapshot() { return { ...this.values }; }

  async setAutoCollapseInactive(enabled) {
    this.values.autoCollapseInactive = Boolean(enabled);
    await this.db?.put?.("settings", SETTINGS_KEY, this.snapshot());
    this.events?.emit?.("editor:canvas-preferences-changed", this.snapshot());
    return this.snapshot();
  }
}

export const EDITOR_CANVAS_DEFAULTS = DEFAULTS;
