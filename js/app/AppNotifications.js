export class AppNotifications {
  constructor({ root, events = null, setTimer = setTimeout, clearTimer = clearTimeout, inlineWhen = null } = {}) {
    this.root = root;
    this.events = events;
    // Browser timer functions are Web API methods and may reject an arbitrary
    // receiver when stored on another object and invoked as `this.setTimer()`.
    this.setTimer = (...args) => Reflect.apply(setTimer, globalThis, args);
    this.clearTimer = (...args) => Reflect.apply(clearTimer, globalThis, args);
    this.inlineWhen = inlineWhen;
    this.timer = null;
    this.lastRuntimeState = "";
    this.unsubscribers = [];
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("ui:error", payload => this.show({ message: payload?.message, type: "error" })),
      this.events?.on?.("ui:toast", payload => this.show(payload)),
      this.events?.on?.("ui:editor-notice", payload => this.show({ ...(payload || {}), silent: true })),
      this.events?.on?.("telegram:runtime-status", status => this.#showRuntimeStatus(status)),
      this.events?.on?.("gallery:ingested", asset => this.#showGalleryIngested(asset)),
      this.events?.on?.("gallery:source-delete-error", ({ error }) => this.show({
        message: `Ресурс сохранён, но исходное сообщение не удалено: ${error?.message || error}`,
        type: "warning",
        duration: 5200
      })),
      this.events?.on?.("project:graph-error", ({ message }) => this.show({
        message: `Project graph: ${message}`,
        type: "error",
        duration: 7000
      }))
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
    this.clearTimer(this.timer);
    this.timer = null;
  }

  show(payload, fallbackType = "info") {
    const data = typeof payload === "string" ? { message: payload, type: fallbackType } : (payload || {});
    const message = String(data.message || "").trim();
    if (!message) return false;
    const type = ["info", "success", "warning", "error"].includes(data.type) ? data.type : fallbackType;
    this.events?.emit?.("ui:notification-shown", { message, type });
    if (data.silent || this.inlineWhen?.() === true) return true;
    if (!this.root) return false;
    this.root.textContent = message;
    this.root.dataset.type = type;
    this.root.classList.add("visible");
    this.clearTimer(this.timer);
    const duration = Math.max(1200, Number(data.duration || (type === "error" ? 5200 : 2800)));
    this.timer = this.setTimer(() => this.root?.classList.remove("visible"), duration);
    return true;
  }

  #showRuntimeStatus(status) {
    const state = status?.state || "";
    if (!state || state === this.lastRuntimeState) return;
    this.lastRuntimeState = state;
    if (state === "running") this.show({ message: status?.message || "Telegram long polling запущен", type: "info" });
    else if (state === "retrying") this.show({ message: status?.message || "Telegram: повтор подключения…", type: "warning", duration: 3600 });
    else if (state === "error") this.show({ message: status?.message || "Ошибка Telegram runtime", type: "error" });
  }

  #showGalleryIngested(asset) {
    const labels = { photo: "Фото", video: "Видео", audio: "Аудио", voice: "Голосовое", document: "Файл" };
    const label = labels[asset?.type] || "Ресурс";
    const name = asset?.caption || asset?.fileName || label;
    this.show({ message: `${label} проиндексировано: ${name}`, type: "success" });
  }
}
