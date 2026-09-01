import { t } from "../i18n/index.js?v=1.8.0";
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
        message: t("app.appNotifications.resourceSavedButTheOriginalMessageWas", { 0: error?.message || error }),
        type: "warning",
        duration: 5200
      })),
      this.events?.on?.("project:graph-error", ({ message }) => this.show({
        message: t("app.appNotifications.projectGraph", { 0: message }),
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
    if (state === "running") this.show({ message: status?.message || t("app.appNotifications.telegramLongPollingStarted"), type: "info" });
    else if (state === "retrying") this.show({ message: status?.message || t("app.appNotifications.telegramReconnecting"), type: "warning", duration: 3600 });
    else if (state === "error") this.show({ message: status?.message || t("app.appNotifications.telegramRuntimeError"), type: "error" });
  }

  #showGalleryIngested(asset) {
    const labels = { photo: t("app.appNotifications.photo"), video: t("app.appNotifications.video"), audio: t("app.appNotifications.audio"), voice: t("app.appNotifications.voice"), document: t("app.appNotifications.file") };
    const label = labels[asset?.type] || t("app.appNotifications.resource");
    const name = asset?.caption || asset?.fileName || label;
    this.show({ message: t("app.appNotifications.indexed", { 0: label, 1: name }), type: "success" });
  }
}
