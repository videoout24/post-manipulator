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

export class LayoutPreferences {
  constructor({ db, events = null, windowRoot = globalThis.window, documentRoot = globalThis.document } = {}) {
    // db remains accepted for compatibility, but panel geometry is deliberately
    // session-only: a width saved on one monitor must not break another one.
    this.db = db;
    this.events = events;
    this.windowRoot = windowRoot;
    this.documentRoot = documentRoot;
    this.values = { ...DEFAULTS };
    this.bound = new WeakSet();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.snapshot();
    this.values = layoutForViewport(this.#viewportWidth());
    this.initialized = true;
    this.apply();
    return this.snapshot();
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
    this.apply();
  }

  async save() {
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
      document.body.classList.add("resizing-layout");
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
        document.body.classList.remove("resizing-layout");
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
}

export function layoutForViewport(viewportWidth) {
  const width = positiveWidth(viewportWidth, 1280);
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [
    key,
    clampValue(key, Math.round(width * VIEWPORT_RATIOS[key]))
  ]));
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
