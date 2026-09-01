import { t } from "../i18n/index.js?v=1.8.0";
const META = Object.freeze({
  photo: { label: t("app.appNotifications.photo"), icon: "▧" },
  video: { label: t("app.appNotifications.video"), icon: "▶" },
  audio: { label: t("app.appNotifications.audio"), icon: "♪" },
  voice: { label: t("editor.editorAssetPicker.voice"), icon: "◖" },
  document: { label: t("editor.editorAssetPicker.files"), icon: "▤" }
});

export class EditorAssetPicker {
  constructor({ root, gallery, thumbnails, binder, tree, controller, events, dragState, onBack = null }) {
    this.root = root;
    this.gallery = gallery;
    this.thumbnails = thumbnails;
    this.binder = binder;
    this.tree = tree;
    this.controller = controller;
    this.events = events;
    this.dragState = dragState;
    this.onBack = onBack;
    this.nodeId = null;
    this.search = "";
    this.thread = "all";
    this.renderGeneration = 0;
    this.renderQueued = false;
    this.#listen();
  }

  #listen() {
    for (const name of ["gallery:asset-added", "gallery:asset-updated", "gallery:asset-removed", "gallery:topic-updated"])
      this.events?.on(name, () => this.queueRender());
  }

  setNode(nodeId) {
    if (this.nodeId !== nodeId) {
      this.nodeId = nodeId;
      this.search = "";
      this.thread = "all";
    }
    return this.render();
  }

  queueRender() {
    if (!this.nodeId || this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render().catch(error => this.#notice(error.message, "error"));
    });
  }

  async render() {
    const generation = ++this.renderGeneration;
    const node = this.nodeId ? this.tree.find(this.nodeId) : null;
    if (!node || !this.binder.supports(node)) {
      this.root.innerHTML = "";
      return;
    }
    const accepted = this.binder.acceptedTypes(node);
    const [assets, topics] = await Promise.all([
      this.gallery.listAssets({}),
      this.gallery.listTopics()
    ]);
    const topicMap = new Map(topics.map(topic => [Number(topic.threadId), topic]));
    const filtered = assets.filter(asset => {
      if (!accepted.includes(asset.type)) return false;
      if (this.thread === "none" && asset.topicThreadId) return false;
      if (this.thread !== "all" && this.thread !== "none" && Number(asset.topicThreadId) !== Number(this.thread)) return false;
      if (this.search) {
        const topic = topicMap.get(Number(asset.topicThreadId));
        const hay = [asset.caption, asset.fileName, topic?.name, asset.id].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(this.search.toLowerCase())) return false;
      }
      return true;
    });
    const title = accepted.map(type => META[type]?.label || type).join(" / ");

    this.root.innerHTML = t("editor.editorAssetPicker.ofGalleryAllTopicsNoTopic", { 0: escapeHtml(title), 1: filtered.length, 2: escapeAttr(this.search), 3: this.thread === "all" ? "selected" : "", 4: this.thread === "none" ? "selected" : "", 5: topics.map(topic => `<option value="${topic.threadId}" ${String(this.thread) === String(topic.threadId) ? "selected" : ""}>${escapeHtml(topic.name)}</option>`).join(""), 6: filtered.length ? filtered.map(asset => this.#card(asset, node, topicMap)).join("") : t("editor.editorAssetPicker.noSuitableResourcesAddThemViaTelegram") });

    this.root.querySelector("#assetPickerBack")?.addEventListener("click", () => this.onBack?.(node.id));
    this.root.querySelector("#assetPickerSearch")?.addEventListener("input", event => {
      this.search = event.target.value;
      this.queueRender();
    });
    this.root.querySelector("#assetPickerTopic")?.addEventListener("change", event => {
      this.thread = event.target.value;
      this.queueRender();
    });

    for (const card of this.root.querySelectorAll("[data-editor-gallery-asset]")) {
      const assetId = card.dataset.editorGalleryAsset;
      const asset = filtered.find(item => item.id === assetId);
      if (!asset) continue;
      card.addEventListener("click", async () => {
        try {
          await this.binder.assign(node.id, asset);
          const action = this.binder.isCollection(node) ? t("editor.editorAssetPicker.added") : t("editor.editorAssetPicker.assignedToBlock");
          this.#notice(`${META[asset.type]?.label || t("app.appNotifications.resource")} ${action}`, "success");
        } catch (error) { this.#notice(error.message, "error"); }
      });
      card.draggable = true;
      card.addEventListener("dragstart", event => {
        this.dragState.source = "gallery";
        this.dragState.galleryAssetId = asset.id;
        this.dragState.galleryType = asset.type;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-gallery-asset-id", asset.id);
        event.dataTransfer.setData("application/x-gallery-asset-type", asset.type);
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        this.dragState.source = "";
        this.dragState.galleryAssetId = "";
        this.dragState.galleryType = "";
      });
    }

    await Promise.allSettled(filtered.map(async asset => {
      if (!asset.telegram?.thumbnailFileId) return;
      const url = await this.thumbnails.getUrl(asset);
      if (!url || generation !== this.renderGeneration) return;
      const host = this.root.querySelector(`[data-editor-asset-thumb="${cssEscape(asset.id)}"]`);
      if (!host) return;
      mountImage(host, asset, url, async () => this.thumbnails.getUrl(asset, { forceRefresh: true }));
    }));
  }

  #card(asset, node, topicMap) {
    const meta = META[asset.type] || { label: asset.type, icon: "◇" };
    const topic = topicMap.get(Number(asset.topicThreadId));
    const selected = node.props?.galleryId === asset.id;
    const title = asset.caption || asset.fileName || meta.label;
    return t("editor.editorAssetPicker.message", { 0: selected ? "selected" : "", 1: asset.id, 2: asset.id, 3: meta.icon, 4: selected ? `<b>✓</b>` : "", 5: escapeHtml(title), 6: escapeHtml(topic?.name || (asset.topicThreadId ? `Topic ${asset.topicThreadId}` : t("editor.editorAssetPicker.noTopic"))) });
  }

  #notice(message, type = "info") { this.events?.emit?.("ui:editor-notice", { message, type }); }
}

function mountImage(host, asset, url, refresh) {
  const img = document.createElement("img");
  img.alt = asset.caption || asset.fileName || asset.type;
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", async () => {
    if (img.dataset.retry === "1") return;
    img.dataset.retry = "1";
    try { const fresh = await refresh(); if (fresh) img.src = fresh; } catch {}
  });
  img.src = url;
  const marker = host.querySelector("b")?.cloneNode(true);
  host.replaceChildren(img);
  if (marker) host.append(marker);
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
