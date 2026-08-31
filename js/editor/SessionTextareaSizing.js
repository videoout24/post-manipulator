export class SessionTextareaSizing {
  constructor() {
    this.preferredRows = new Map();
  }

  attach(textarea, { key = "", defaultRows = 3, minRows = 1, autoShrink = false } = {}) {
    if (!(textarea instanceof HTMLTextAreaElement)) return textarea;
    const storageKey = String(key || textarea.name || textarea.id || "anonymous");
    const minimum = Math.max(1, Number(minRows || 1));
    const initial = Math.max(minimum, Number(defaultRows || minimum));
    if (!this.preferredRows.has(storageKey)) this.preferredRows.set(storageKey, initial);

    textarea.classList.add("session-autosize-textarea");
    textarea.style.overflowY = "hidden";
    textarea.style.overflowX = "hidden";
    textarea.rows = 1;
    if (!autoShrink) {
      textarea.title = [textarea.title, "Alt+↑ — ниже на строку; Alt+↓ — выше на строку"].filter(Boolean).join(" · ");
    }

    const refresh = () => this.refresh(textarea, { key: storageKey, defaultRows: initial, minRows: minimum, autoShrink });
    const rememberManualHeight = () => {
      const metrics = textareaMetrics(textarea);
      if (!metrics.lineHeight) return refresh();
      const visible = Math.max(minimum, Math.round((textarea.getBoundingClientRect().height - metrics.chrome) / metrics.lineHeight));
      const contentRows = this.contentRows(textarea, metrics);
      this.preferredRows.set(storageKey, Math.max(contentRows, visible));
      refresh();
    };

    textarea.addEventListener("input", refresh);
    textarea.addEventListener("change", refresh);
    if (!autoShrink) {
      textarea.addEventListener("mouseup", () => requestAnimationFrame(rememberManualHeight));
      textarea.addEventListener("pointerup", () => requestAnimationFrame(rememberManualHeight));
      textarea.addEventListener("keydown", event => {
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const metrics = textareaMetrics(textarea);
        const contentRows = this.contentRows(textarea, metrics);
        const current = Math.max(minimum, Number(this.preferredRows.get(storageKey) || initial));
        const next = event.key === "ArrowDown" ? current + 1 : Math.max(contentRows, minimum, current - 1);
        this.preferredRows.set(storageKey, next);
        refresh();
      });
    }

    requestAnimationFrame(refresh);
    return textarea;
  }

  refresh(textarea, { key = "", defaultRows = 3, minRows = 1, autoShrink = false } = {}) {
    if (!(textarea instanceof HTMLTextAreaElement) || !textarea.isConnected) return;
    const metrics = textareaMetrics(textarea);
    const contentRows = this.contentRows(textarea, metrics);
    const preferred = Math.max(minRows, Number(this.preferredRows.get(key) || defaultRows || minRows));
    const rows = autoShrink ? Math.max(contentRows, minRows) : Math.max(contentRows, preferred, minRows);
    textarea.style.height = `${Math.ceil(rows * metrics.lineHeight + metrics.chrome)}px`;
    textarea.dataset.rows = String(rows);
  }

  contentRows(textarea, metrics = textareaMetrics(textarea)) {
    if (!metrics.lineHeight) return 1;
    const previous = textarea.style.height;
    textarea.style.height = "auto";
    const contentHeight = Math.max(metrics.lineHeight, textarea.scrollHeight - metrics.padding);
    textarea.style.height = previous;

    // scrollHeight is integer-rounded by browsers while computed line-height is often
    // fractional (e.g. 18.2px). Line boxes themselves are discrete, so rounding the
    // quotient is more accurate than ceil(): 19 / 18.2 is still one visual line, while
    // 37 / 18.2 is two. This removes the phantom +1 row without hiding real wraps.
    return Math.max(1, Math.round(contentHeight / metrics.lineHeight));
  }

  clear() { this.preferredRows.clear(); }
}

function textareaMetrics(textarea) {
  const style = getComputedStyle(textarea);
  const fontSize = Number.parseFloat(style.fontSize) || 14;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.35;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
  return {
    lineHeight,
    padding: paddingTop + paddingBottom,
    chrome: paddingTop + paddingBottom + borderTop + borderBottom
  };
}
