export const FONT_SIZE_PREFERENCE_KEY = "postManipulatorFontSizes";
export const FONT_SIZE_TOKENS = Object.freeze([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 34, 54]);
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

export class FontPreferences {
  constructor({ windowRoot = globalThis.window || globalThis, documentRoot = globalThis.document } = {}) {
    this.windowRoot = windowRoot;
    this.documentRoot = documentRoot;
    this.values = this.#read();
    this.listeners = new Set();
    this.started = false;
    this.onStorage = event => {
      if (event.key !== FONT_SIZE_PREFERENCE_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== this.windowRoot.localStorage) return;
      } catch { return; }
      this.values = this.#read(event.newValue);
      this.apply();
      this.#notify();
    };
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.windowRoot.addEventListener?.("storage", this.onStorage);
    this.apply();
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.windowRoot.removeEventListener?.("storage", this.onStorage);
  }

  getValue(token) {
    const size = Number(token);
    if (!FONT_SIZE_TOKENS.includes(size)) return null;
    return this.values[size] ?? size;
  }

  getValues() {
    return Object.freeze(Object.fromEntries(FONT_SIZE_TOKENS.map(token => [token, this.getValue(token)])));
  }

  hasCustomizations() {
    return Object.keys(this.values).length > 0;
  }

  setValue(token, value) {
    const size = Number(token);
    const normalized = normalizeFontSize(value);
    if (!FONT_SIZE_TOKENS.includes(size) || normalized == null) return false;
    if (normalized === size) delete this.values[size];
    else this.values[size] = normalized;
    this.#persist();
    this.apply();
    this.#notify();
    return true;
  }

  reset() {
    this.values = {};
    try { this.windowRoot.localStorage?.removeItem?.(FONT_SIZE_PREFERENCE_KEY); } catch {}
    this.apply();
    this.#notify();
  }

  apply() {
    const style = this.documentRoot?.documentElement?.style;
    if (!style) return this.getValues();
    for (const token of FONT_SIZE_TOKENS) {
      const property = `--font-size-${token}`;
      if (this.values[token] == null) style.removeProperty?.(property);
      else style.setProperty?.(property, `${this.values[token]}px`);
    }
    return this.getValues();
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #read(serialized) {
    let raw = serialized;
    if (arguments.length === 0) {
      try { raw = this.windowRoot.localStorage?.getItem?.(FONT_SIZE_PREFERENCE_KEY); } catch { raw = null; }
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      const values = {};
      for (const token of FONT_SIZE_TOKENS) {
        const value = normalizeFontSize(parsed?.[token]);
        if (value != null && value !== token) values[token] = value;
      }
      return values;
    } catch {
      return {};
    }
  }

  #persist() {
    try {
      if (this.hasCustomizations()) {
        this.windowRoot.localStorage?.setItem?.(FONT_SIZE_PREFERENCE_KEY, JSON.stringify(this.values));
      } else {
        this.windowRoot.localStorage?.removeItem?.(FONT_SIZE_PREFERENCE_KEY);
      }
    } catch {}
  }

  #notify() {
    const values = this.getValues();
    for (const listener of this.listeners) listener(values);
  }
}

function normalizeFontSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < MIN_FONT_SIZE || number > MAX_FONT_SIZE) return null;
  return Math.round(number * 10) / 10;
}

export const fontPreferences = new FontPreferences();
