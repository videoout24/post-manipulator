export class TelegramViewportController {
  constructor({ webApp, windowRoot = globalThis.window, documentRoot = globalThis.document, logger = console } = {}) {
    this.webApp = webApp;
    this.windowRoot = windowRoot;
    this.documentRoot = documentRoot;
    this.logger = logger;
    this.started = false;
    this.snapshot = null;
    this.sync = () => this.#syncViewport();
  }

  start() {
    if (this.started) return this.snapshot;
    this.started = true;
    this.webApp?.onEvent?.("viewportChanged", this.sync);
    this.windowRoot?.addEventListener?.("resize", this.sync);
    this.windowRoot?.visualViewport?.addEventListener?.("resize", this.sync);
    return this.#syncViewport();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.webApp?.offEvent?.("viewportChanged", this.sync);
    this.windowRoot?.removeEventListener?.("resize", this.sync);
    this.windowRoot?.visualViewport?.removeEventListener?.("resize", this.sync);
  }

  #syncViewport() {
    const viewportWidth = positiveNumber(
      this.windowRoot?.visualViewport?.width,
      this.windowRoot?.innerWidth,
      this.documentRoot?.documentElement?.clientWidth
    );
    const viewportHeight = positiveNumber(
      this.webApp?.viewportStableHeight,
      this.windowRoot?.visualViewport?.height,
      this.windowRoot?.innerHeight,
      this.documentRoot?.documentElement?.clientHeight
    );
    const screenWidth = positiveNumber(this.windowRoot?.screen?.availWidth, this.windowRoot?.screen?.width, viewportWidth);
    const screenHeight = positiveNumber(this.windowRoot?.screen?.availHeight, this.windowRoot?.screen?.height, viewportHeight);
    const preferredWidth = screenWidth ? Math.round(screenWidth * 2 / 3) : viewportWidth;
    const style = this.documentRoot?.documentElement?.style;
    if (viewportWidth) style?.setProperty?.("--app-viewport-width", `${Math.round(viewportWidth)}px`);
    if (viewportHeight) {
      style?.setProperty?.("--app-viewport-height", `${Math.round(viewportHeight)}px`);
      style?.setProperty?.("--editor-bottom-spacer-height", `${Math.round(viewportHeight / 2)}px`);
    }
    if (preferredWidth) style?.setProperty?.("--app-preferred-window-width", `${preferredWidth}px`);
    const body = this.documentRoot?.body;
    if (body?.dataset) {
      body.dataset.telegramViewport = "true";
      body.dataset.telegramPlatform = String(this.webApp?.platform || "unknown");
    }
    this.snapshot = Object.freeze({
      viewportWidth,
      viewportHeight,
      screenWidth,
      screenHeight,
      preferredWidth,
      widthManagedByTelegram: true
    });
    return this.snapshot;
  }
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}
