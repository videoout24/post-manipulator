import { t } from "../i18n/index.js?v=1.8.6";

export class OperationFeedback {
  constructor({ events, documentRoot = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { events, documentRoot });
    this.setTimer = (...args) => Reflect.apply(setTimer, globalThis, args);
    this.clearTimer = (...args) => Reflect.apply(clearTimer, globalThis, args);
    this.requests = new Map();
    this.tasks = new Map();
    this.unsubscribers = [];
    this.hideTimer = null;
    this.root = null;
    this.visible = false;
    this.last = null;
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      this.events.on("telegram:operation-start", operation => {
        this.requests.set(operation.id, operation);
        this.#update();
      }),
      this.events.on("telegram:operation-end", operation => {
        this.requests.delete(operation.id);
        this.#update();
      }),
      this.events.on("gallery:upload-progress", progress => {
        const key = `upload:${progress.uploadId || "current"}`;
        if (progress.state === "uploading") {
          this.tasks.set(key, {
            title: t("app.operation.uploading"),
            detail: t("gallery.galleryView.uploading", { 0: progress.current, 1: progress.total, 2: progress.fileName }),
            current: Math.max(0, progress.current - 1), total: progress.total
          });
        } else {
          this.tasks.delete(key);
          this.last = {
            title: t(progress.state === "partial" ? "app.operation.partial" : "app.operation.complete"),
            detail: t("gallery.galleryCore.uploadedOfErrors", { 0: progress.assets?.length || 0, 1: progress.total, 2: progress.failures?.length || 0 }),
            current: progress.total, total: progress.total
          };
        }
        this.#update();
      }),
      this.events.on("project:publication", progress => this.#projectProgress("publication", progress)),
      this.events.on("project:publication-phase-ended", ({ projectId }) => {
        this.tasks.delete(`publication:${projectId}`);
        this.#update();
      }),
      this.events.on("project:preview-sync", progress => this.#projectProgress("preview", progress))
    );
    if (this.documentRoot && globalThis.MutationObserver) {
      this.observer = new MutationObserver(() => { if (this.visible) this.#mount(); });
      this.observer.observe(this.documentRoot.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    }
    return this;
  }

  stop() {
    for (const off of this.unsubscribers.splice(0)) off?.();
    this.clearTimer(this.hideTimer);
    this.observer?.disconnect();
    this.requests.clear();
    this.tasks.clear();
    this.visible = false;
    this.root?.remove();
    this.root = null;
  }

  snapshot() {
    const task = [...this.tasks.values()].at(-1);
    const request = [...this.requests.values()].find(item => item.fileName) || [...this.requests.values()].at(-1);
    const active = this.tasks.size > 0 || this.requests.size > 0;
    const content = task || (request ? {
      title: requestLabel(request),
      detail: request.fileName || t("app.operation.waiting"),
      current: null, total: null
    } : this.last || { title: t("app.operation.requestFinished"), detail: "", current: null, total: null });
    return { ...content, active, visible: this.visible, requestCount: this.requests.size };
  }

  #projectProgress(kind, progress = {}) {
    if (!progress.projectId) return;
    const key = `${kind}:${progress.projectId}`;
    const starting = ["publishing", "resolving", "updating", "unpublishing", "materializing", "removing"];
    const terminal = ["published", "updated", "unpublished", "partial", "scheduled", "schedule-cancelled", "schedule-error", "synced", "removed", "remove-partial", "error", "waiting"];
    if (starting.includes(progress.state)) {
      this.tasks.set(key, {
        title: t(["unpublishing", "removing"].includes(progress.state) ? "app.operation.deleting"
          : progress.state === "resolving" ? "app.operation.resolving"
          : kind === "preview" ? "app.operation.preview" : "app.operation.publishing"),
        detail: progress.project?.title || "",
        current: Number(progress.current || 0), total: Number(progress.total || 0) || null
      });
    } else if (terminal.includes(progress.state)) {
      if (!this.tasks.has(key)) return;
      this.tasks.delete(key);
      this.last = { title: t("app.operation.requestFinished"), detail: "", current: null, total: null };
    } else return;
    this.#update();
  }

  #update() {
    this.clearTimer(this.hideTimer);
    const state = this.snapshot();
    if (state.active) {
      this.visible = true;
      this.last = null;
    } else if (this.visible) {
      this.hideTimer = this.setTimer(() => {
        this.visible = false;
        this.last = null;
        this.root?.remove();
      }, this.last?.detail ? 2400 : 500);
    }
    this.#render();
  }

  #mount() {
    if (!this.root || !this.documentRoot?.body) return;
    // A body overlay is hidden behind native modal dialogs. Mount in the top
    // open dialog, and move back to the shell when that dialog closes/removes.
    const host = [...this.documentRoot.querySelectorAll("dialog[open]")].at(-1) || this.documentRoot.body;
    if (this.root.parentNode !== host) host.append(this.root);
  }

  #render() {
    if (!this.visible || !this.documentRoot) return;
    if (!this.root) {
      this.root = this.documentRoot.createElement("aside");
      this.root.className = "operation-feedback";
      this.root.setAttribute("role", "status");
      this.root.setAttribute("aria-live", "polite");
      this.root.innerHTML = '<span class="operation-feedback-spinner" aria-hidden="true"></span><div class="operation-feedback-content"><strong></strong><span class="operation-feedback-detail"></span><progress></progress><span class="operation-feedback-count"></span></div>';
    }
    const state = this.snapshot();
    this.root.dataset.active = String(state.active);
    this.root.querySelector("strong").textContent = state.title;
    this.root.querySelector(".operation-feedback-detail").textContent = state.detail;
    const progress = this.root.querySelector("progress");
    progress.setAttribute("aria-label", state.title);
    progress.hidden = !state.active;
    if (state.total > 0) {
      progress.max = state.total;
      progress.value = Math.min(state.total, Math.max(0, state.current || 0));
    } else progress.removeAttribute("value");
    this.root.querySelector(".operation-feedback-count").textContent = state.total > 0
      ? t("app.operation.progress", { current: Math.min(state.total, state.current || 0), total: state.total })
      : state.requestCount > 1 ? t("app.operation.requests", { count: state.requestCount }) : "";
    this.#mount();
  }
}

function requestLabel({ method = "", fileName = "" }) {
  if (fileName) return t("app.operation.uploading");
  if (/^delete/.test(method)) return t("app.operation.deleting");
  if (/^send/.test(method)) return t("app.operation.publishing");
  if (/^edit/.test(method)) return t("app.operation.updating");
  if (/ForumTopic$/.test(method)) return t("app.operation.topic");
  if (/^(un)?pin/.test(method)) return t("app.operation.pinning");
  return t("app.operation.requesting");
}
