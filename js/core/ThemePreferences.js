export const THEME_PREFERENCE_KEY = "postManipulatorTheme";
export const DEFAULT_THEME = "dark";
const preferences = ["dark", "light", "auto"];

export class ThemePreferences {
  constructor({ windowRoot = globalThis.window || globalThis, documentRoot = globalThis.document } = {}) {
    this.windowRoot = windowRoot;
    this.documentRoot = documentRoot;
    this.preference = DEFAULT_THEME;
    try {
      const stored = windowRoot.localStorage?.getItem(THEME_PREFERENCE_KEY);
      if (preferences.includes(stored)) this.preference = stored;
    } catch {}
    try { this.mediaQuery = windowRoot.matchMedia?.("(prefers-color-scheme: light)"); } catch {}
    this.started = false;
    this.onEnvironmentChange = () => this.apply();
    this.onStorage = event => {
      if (event.key !== THEME_PREFERENCE_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== this.windowRoot.localStorage) return;
      } catch { return; }
      this.preference = preferences.includes(event.newValue) ? event.newValue : DEFAULT_THEME;
      this.apply();
    };
    // Keep subscriptions for a page suspended in the browser's back/forward cache.
    this.onPageHide = event => { if (!event?.persisted) this.stop(); };
    this.onPageShow = () => this.apply();
  }

  getPreference() { return this.preference; }

  setPreference(value) {
    this.preference = preferences.includes(value) ? value : DEFAULT_THEME;
    try { this.windowRoot.localStorage?.setItem(THEME_PREFERENCE_KEY, this.preference); } catch {}
    return this.apply();
  }

  resolve() {
    if (this.preference !== "auto") return this.preference;
    const scheme = this.windowRoot.Telegram?.WebApp?.colorScheme;
    if (scheme === "light" || scheme === "dark") return scheme;
    return this.mediaQuery?.matches ? "light" : DEFAULT_THEME;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.webApp = this.windowRoot.Telegram?.WebApp;
    try { this.webApp?.onEvent?.("themeChanged", this.onEnvironmentChange); } catch {}
    this.mediaQuery?.addEventListener?.("change", this.onEnvironmentChange);
    this.windowRoot.addEventListener?.("storage", this.onStorage);
    this.windowRoot.addEventListener?.("pagehide", this.onPageHide);
    this.windowRoot.addEventListener?.("pageshow", this.onPageShow);
    this.apply();
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    try { this.webApp?.offEvent?.("themeChanged", this.onEnvironmentChange); } catch {}
    this.mediaQuery?.removeEventListener?.("change", this.onEnvironmentChange);
    this.windowRoot.removeEventListener?.("storage", this.onStorage);
    this.windowRoot.removeEventListener?.("pagehide", this.onPageHide);
    this.windowRoot.removeEventListener?.("pageshow", this.onPageShow);
  }

  apply() {
    const theme = this.resolve();
    const root = this.documentRoot?.documentElement;
    if (root) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
      // Update an already mounted Settings view without rebuilding any UI.
      const select = this.documentRoot.querySelector?.("#appThemePreference");
      if (select) select.value = this.preference;
      this.syncTelegramChrome(root);
    }
    return theme;
  }

  syncTelegramChrome(root) {
    const webApp = this.windowRoot.Telegram?.WebApp;
    if (!webApp) return;
    // Read the actual CSS surfaces so native chrome and the document agree.
    const header = this.documentRoot.querySelector?.(".topbar") || root;
    for (const [method, node, version] of [
      ["setHeaderColor", header, "6.9"],
      ["setBackgroundColor", root, "6.1"],
      ["setBottomBarColor", root, "7.10"]
    ]) {
      try {
        if (!webApp.isVersionAtLeast?.(version) || typeof webApp[method] !== "function") continue;
        const color = rgbToHex(this.windowRoot.getComputedStyle?.(node).backgroundColor);
        if (color) webApp[method](color);
      } catch { /* Cosmetic bridge errors must never interrupt startup or editing. */ }
    }
  }
}

function rgbToHex(value) {
  const channels = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value || "");
  return channels ? `#${channels.slice(1).map(channel => Number(channel).toString(16).padStart(2, "0")).join("")}` : null;
}

export const themePreferences = new ThemePreferences();
