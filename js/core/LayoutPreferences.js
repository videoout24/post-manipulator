const DEFAULTS = Object.freeze({
  editorLeft: 230,
  editorProject: 260,
  galleryLeft: 220,
  galleryRight: 320,
  projectLibraryLeft: 260,
  projectLibraryRight: 340,
  publicationsLeft: 300,
  publicationsRight: 340
});

const LIMITS = Object.freeze({
  editorLeft: [160, 520],
  editorProject: [210, 520],
  galleryLeft: [150, 460],
  galleryRight: [250, 620],
  projectLibraryLeft: [180, 560],
  projectLibraryRight: [260, 680],
  publicationsLeft: [220, 600],
  publicationsRight: [260, 680]
});

const VIEWPORT_RATIOS = Object.freeze({
  editorLeft: 0.18,
  editorProject: 0.22,
  galleryLeft: 0.17,
  galleryRight: 0.25,
  projectLibraryLeft: 0.20,
  projectLibraryRight: 0.27,
  publicationsLeft: 0.23,
  publicationsRight: 0.27
});

const TAB_KEYS = Object.freeze({
  editor: Object.freeze(["editorLeft", "editorProject"]),
  gallery: Object.freeze(["galleryLeft", "galleryRight"]),
  project: Object.freeze(["projectLibraryLeft", "projectLibraryRight"]),
  publications: Object.freeze(["publicationsLeft", "publicationsRight"])
});

const MAX_RATIOS = Object.freeze({
  editorLeft: 0.30,
  editorProject: 0.32,
  galleryLeft: 0.28,
  galleryRight: 0.32,
  projectLibraryLeft: 0.30,
  projectLibraryRight: 0.32,
  publicationsLeft: 0.30,
  publicationsRight: 0.32
});

const SETTINGS_KEY = "ui.layout.preferences";
const SETTINGS_VERSION = 1;

export class LayoutPreferences {
  constructor({ db, events = null, windowRoot = globalThis.window, documentRoot = globalThis.document } = {}) {
    this.db = db;
    this.events = events;
    this.windowRoot = windowRoot;
    this.documentRoot = documentRoot;
    this.values = { ...DEFAULTS };
    this.ratios = { ...VIEWPORT_RATIOS };
    this.pendingKeys = new Set();
    this.bound = new WeakSet();
    this.initialized = false;
    this.viewportWidth = 0;
    this.onResize = () => this.#restoreRatios();
  }

  async initialize() {
    if (this.initialized) return this.snapshot();
    const stored = await this.db?.get?.("settings", SETTINGS_KEY, null);
    this.ratios = readStoredRatios(stored);
    this.viewportWidth = this.#viewportWidth();
    this.values = layoutForViewport(this.viewportWidth, this.ratios);
    this.initialized = true;
    this.apply();
    this.windowRoot?.addEventListener?.("resize", this.onResize);
    this.windowRoot?.visualViewport?.addEventListener?.("resize", this.onResize);
    return this.snapshot();
  }

  stop() {
    this.windowRoot?.removeEventListener?.("resize", this.onResize);
    this.windowRoot?.visualViewport?.removeEventListener?.("resize", this.onResize);
  }

  snapshot() { return { ...this.values }; }
  get(key) { return this.values[key] ?? DEFAULTS[key]; }

  apply() {
    const style = this.documentRoot?.documentElement?.style;
    if (!style?.setProperty) return;
    style.setProperty("--editor-left-width", `${this.get("editorLeft")}px`);
    style.setProperty("--editor-project-width", `${this.get("editorProject")}px`);
    style.setProperty("--gallery-left-width", `${this.get("galleryLeft")}px`);
    style.setProperty("--gallery-right-width", `${this.get("galleryRight")}px`);
    style.setProperty("--project-library-left-width", `${this.get("projectLibraryLeft")}px`);
    style.setProperty("--project-library-right-width", `${this.get("projectLibraryRight")}px`);
    style.setProperty("--publications-left-width", `${this.get("publicationsLeft")}px`);
    style.setProperty("--publications-right-width", `${this.get("publicationsRight")}px`);
  }

  setLocal(key, value) {
    if (!(key in DEFAULTS)) return;
    this.values[key] = clampValue(key, value);
    this.pendingKeys.add(key);
    this.apply();
  }

  async save() {
    const viewportWidth = this.#viewportWidth();
    const changedKeys = [...this.pendingKeys];
    for (const key of changedKeys) {
      this.ratios[key] = clampRatio(key, this.get(key) / viewportWidth);
      this.values[key] = clampValue(key, viewportWidth * this.ratios[key]);
    }
    if (changedKeys.length) this.apply();
    if (changedKeys.length && this.db?.put) {
      await this.db.put("settings", SETTINGS_KEY, serializeRatios(this.ratios));
    }
    for (const key of changedKeys) this.pendingKeys.delete(key);
    this.events?.emit?.("layout:changed", this.snapshot());
  }

  bindSplitter(element, { key, edge = "left" } = {}) {
    if (!element || !key || this.bound.has(element)) return;
    this.bound.add(element);
    element.dataset.layoutKey = key;
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", "vertical");
    element.tabIndex = 0;

    const startDrag = event => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startValue = this.get(key);
      element.classList.add("active");
      this.documentRoot?.body?.classList?.add("resizing-layout");
      element.setPointerCapture?.(event.pointerId);

      const move = moveEvent => {
        const delta = moveEvent.clientX - startX;
        this.setLocal(key, edge === "right" ? startValue - delta : startValue + delta);
      };
      const end = async endEvent => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", end);
        element.removeEventListener("pointercancel", end);
        element.classList.remove("active");
        this.documentRoot?.body?.classList?.remove("resizing-layout");
        try { element.releasePointerCapture?.(endEvent.pointerId); } catch {}
        await this.save();
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", end);
      element.addEventListener("pointercancel", end);
    };

    element.addEventListener("pointerdown", startDrag);
    element.addEventListener("keydown", async event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const delta = edge === "right" ? -direction * 12 : direction * 12;
      this.setLocal(key, this.get(key) + delta);
      await this.save();
    });
  }

  #viewportWidth() {
    return positiveWidth(
      this.windowRoot?.visualViewport?.width,
      this.windowRoot?.innerWidth,
      this.documentRoot?.documentElement?.clientWidth,
      1280
    );
  }

  #restoreRatios() {
    if (!this.initialized) return;
    const viewportWidth = this.#viewportWidth();
    if (viewportWidth === this.viewportWidth) return;
    this.viewportWidth = viewportWidth;
    this.values = layoutForViewport(viewportWidth, this.ratios);
    this.apply();
    this.events?.emit?.("layout:changed", this.snapshot());
  }
}

export function layoutForViewport(viewportWidth, ratios = VIEWPORT_RATIOS) {
  const width = positiveWidth(viewportWidth, 1280);
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [
    key,
    clampValue(key, Math.round(width * validRatio(key, ratios?.[key])))
  ]));
}

function readStoredRatios(stored) {
  const ratios = { ...VIEWPORT_RATIOS };
  for (const [tab, keys] of Object.entries(TAB_KEYS)) {
    const tabRatios = stored?.version === SETTINGS_VERSION ? stored.tabs?.[tab] : null;
    for (const key of keys) ratios[key] = validRatio(key, tabRatios?.[key]);
  }
  return ratios;
}

function serializeRatios(ratios) {
  return {
    version: SETTINGS_VERSION,
    tabs: Object.fromEntries(Object.entries(TAB_KEYS).map(([tab, keys]) => [
      tab,
      Object.fromEntries(keys.map(key => [key, roundRatio(validRatio(key, ratios?.[key]))]))
    ]))
  };
}

function validRatio(key, value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio > 0
    ? clampRatio(key, ratio)
    : VIEWPORT_RATIOS[key];
}

function clampRatio(key, value) {
  return Math.max(0.001, Math.min(MAX_RATIOS[key] || 0.8, Number(value)));
}

function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clampValue(key, value) {
  const n = Number(value);
  const [min, max] = LIMITS[key] || [100, 1000];
  if (!Number.isFinite(n)) return DEFAULTS[key];
  return Math.max(min, Math.min(max, Math.round(n)));
}

function positiveWidth(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 1280;
}

export const LAYOUT_DEFAULTS = DEFAULTS;
export const LAYOUT_TAB_KEYS = TAB_KEYS;
