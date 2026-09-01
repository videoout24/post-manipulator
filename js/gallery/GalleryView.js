import { t } from "../i18n/index.js?v=1.8.0";
import { confirmDarkDialog, requestTextDialog } from "../core/DarkDialog.js?v=1.6.5";

const TYPE_META = Object.freeze({
  photo: { label: t("app.appNotifications.photo"), icon: "▧" },
  video: { label: t("app.appNotifications.video"), icon: "▶" },
  audio: { label: t("app.appNotifications.audio"), icon: "♪" },
  voice: { label: t("editor.editorAssetPicker.voice"), icon: "◖" },
  document: { label: t("editor.editorAssetPicker.files"), icon: "▤" }
});

export class GalleryView {
  constructor({ root, gallery, thumbnails, events, navigation = null, layoutPreferences = null }) {
    this.root = root;
    this.gallery = gallery;
    this.thumbnails = thumbnails;
    this.events = events;
    this.navigation = navigation;
    this.layoutPreferences = layoutPreferences;
    this.filterType = "all";
    this.filterThread = "all";
    this.search = "";
    this.selectedId = null;
    this.renderQueued = false;
    this.renderGeneration = 0;
    this.#listen();
  }

  async initialize() {
    this.gallery.start();
    await this.render();
  }

  #listen() {
    for (const name of [
      "gallery:asset-added",
      "gallery:asset-updated",
      "gallery:asset-removed",
      "gallery:topic-updated",
      "gallery:topic-removed",
      "gallery:settings",
      "gallery:thumbnail-cache-cleared"
    ]) this.events?.on(name, () => this.queueRender());

    this.events?.on("gallery:source-delete-error", ({ error }) => {
      this.#notice(t("gallery.galleryView.resourceSavedButTheOriginalMessageCould", { 0: error?.message || error }), true);
    });
  }

  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render().catch(error => this.#notice(error.message, true));
    });
  }

  async render() {
    const generation = ++this.renderGeneration;
    const focusState = captureFocus(this.root);
    const [allAssets, topics, settings, cacheStats] = await Promise.all([
      this.gallery.listAssets({}),
      this.gallery.listTopics(),
      this.gallery.getSettings(),
      this.thumbnails.stats()
    ]);

    const topicMap = new Map(topics.map(topic => [Number(topic.threadId), topic]));
    const filtered = allAssets.filter(asset => {
      if (this.filterType !== "all" && asset.type !== this.filterType) return false;
      if (this.filterThread === "none" && asset.topicThreadId) return false;
      if (this.filterThread !== "all" && this.filterThread !== "none" && Number(asset.topicThreadId) !== Number(this.filterThread)) return false;
      if (this.search) {
        const topic = topicMap.get(Number(asset.topicThreadId));
        const haystack = [asset.caption, asset.fileName, asset.mimeType, asset.id, topic?.name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(this.search.toLowerCase())) return false;
      }
      return true;
    });

    const selected = this.selectedId ? allAssets.find(asset => asset.id === this.selectedId) || null : null;
    if (this.selectedId && !selected) this.selectedId = null;

    this.root.innerHTML = `
      <div class="gallery-header">
        <div>
          <h1>${t("gallery.galleryView.gallery")}</h1>
          <p>${t("gallery.galleryView.telegramStoresTheOriginalsOnlyMetadataAnd")}</p>
        </div>
        <div class="gallery-header-stats">
          <span>${allAssets.length} ${t("gallery.galleryView.resources")}</span>
          <span>${cacheStats.count} thumbnail URL · browser cache</span>
        </div>
      </div>

      <div class="gallery-toolbar">
        <input id="gallerySearch" class="gallery-search" placeholder="${t("gallery.galleryView.searchByCaptionNameTopic")}" value="${escapeAttr(this.search)}">
        <button id="galleryOpenBot">${t("gallery.galleryView.openBot")}</button>
        <button class="primary" id="galleryUploadFiles">${t("gallery.galleryView.uploadFiles")}</button>
        <button id="galleryNewTopic">＋ Topic</button>
        <label class="gallery-toggle"><input id="galleryDeleteSource" type="checkbox" ${settings.deleteSourceAfterIndexing ? "checked" : ""}> ${t("gallery.galleryView.deleteMessageAfterIndexing")}</label>
        <button id="galleryClearThumbs">${t("gallery.galleryView.refreshThumbnails")}</button>
      </div>

      <div class="gallery-layout">
        <aside class="gallery-sidebar">
          <div class="gallery-side-section">
            <div class="gallery-side-title">${t("gallery.galleryView.type")}</div>
            ${this.#filterButton("all", t("editor.blockPalette.all"), allAssets.length, this.filterType === "all", "type")}
            ${Object.entries(TYPE_META).map(([type, meta]) => this.#filterButton(type, `${meta.icon} ${meta.label}`, countBy(allAssets, a => a.type === type), this.filterType === type, "type")).join("")}
          </div>

          <div class="gallery-side-section gallery-topic-section">
            <div class="gallery-side-title">${t("gallery.galleryView.topics")}</div>
            ${this.#filterButton("all", t("editor.blockPalette.all"), allAssets.length, this.filterThread === "all", "topic")}
            ${this.#filterButton("none", t("editor.editorAssetPicker.noTopic"), countBy(allAssets, a => !a.topicThreadId), this.filterThread === "none", "topic")}
            <div class="gallery-topic-list">
              ${topics.map(topic => {
                const count = countBy(allAssets, a => Number(a.topicThreadId) === Number(topic.threadId));
                return t("gallery.galleryView.message", { 0: this.filterThread == topic.threadId ? "active" : "", 1: topic.telegramDeleted ? "local-only" : "", 2: topic.threadId, 3: escapeAttr(topic.name), 4: topic.systemRole === "preview" ? "◆ " : "", 5: escapeHtml(topic.name || `Topic ${topic.threadId}`), 6: count, 7: topic.telegramDeleted ? "" : t("gallery.galleryView.message2", { 0: topic.threadId }), 8: topic.threadId, 9: escapeAttr(topic.name || "") });
              }).join("")}
            </div>
          </div>
        </aside>

        <div class="layout-splitter gallery-splitter" data-gallery-splitter="left" title="${t("gallery.galleryView.changeFilterWidth")}"></div>

        <section class="gallery-content">
          <div class="gallery-content-head">
            <strong>${filtered.length} ${pluralResources(filtered.length)}</strong>
            <span>${describeFilters(this.filterType, this.filterThread, topicMap)}</span>
          </div>
          <div id="galleryGrid" class="gallery-grid">
            ${filtered.length ? filtered.map(asset => this.#assetCard(asset, topicMap)).join("") : t("gallery.galleryView.itSEmptyHereForNowSend")}
          </div>
        </section>

        <div class="layout-splitter gallery-splitter" data-gallery-splitter="right" title="${t("gallery.galleryView.changeResourcePropertyWidth")}"></div>

        <aside class="gallery-details ${selected ? "visible" : ""}" id="galleryDetails">
          ${selected ? this.#details(selected, topicMap.get(Number(selected.topicThreadId))) : t("gallery.galleryView.selectAResource")}
        </aside>
      </div>
    `;

    this.#bindUi(topics);
    restoreFocus(this.root, focusState);
    await this.#loadThumbnails(filtered, selected, generation);
  }

  #bindUi(topics = []) {
    this.layoutPreferences?.bindSplitter(this.root.querySelector('[data-gallery-splitter="left"]'), { key: "galleryLeft", edge: "left" });
    this.layoutPreferences?.bindSplitter(this.root.querySelector('[data-gallery-splitter="right"]'), { key: "galleryRight", edge: "right" });
    this.root.querySelector("#gallerySearch")?.addEventListener("input", event => {
      this.search = event.target.value;
      this.queueRender();
    });

    for (const button of this.root.querySelectorAll("[data-gallery-filter-type]")) {
      button.addEventListener("click", () => {
        this.filterType = button.dataset.galleryFilterType;
        this.queueRender();
      });
    }
    for (const button of this.root.querySelectorAll("[data-gallery-topic]")) {
      button.addEventListener("click", () => {
        this.filterThread = button.dataset.galleryTopic;
        this.queueRender();
      });
    }
    for (const card of this.root.querySelectorAll("[data-gallery-asset]")) {
      card.addEventListener("click", event => {
        if (event.target.closest("button")) return;
        this.selectedId = card.dataset.galleryAsset;
        this.queueRender();
      });
    }

    this.root.querySelector("#galleryNewTopic")?.addEventListener("click", async () => {
      const name = await requestTextDialog({ title: t("gallery.galleryView.newTopic"), label: t("gallery.galleryView.topicTitle"), submitLabel: t("editor.editorCommandController.create") });
      if (!name) return;
      await this.#run(async () => {
        const topic = await this.gallery.createTopic(name);
        this.filterThread = String(topic.threadId);
        this.#notice(t("gallery.galleryView.topicCreated", { 0: topic.name }));
      });
    });
    this.root.querySelector("#galleryOpenBot")?.addEventListener("click", () => {
      if (!this.navigation?.openBot?.()) this.#notice(t("gallery.galleryView.failedToOpenBotUsernameUnavailable"), true);
    });
    this.root.querySelector("#galleryUploadFiles")?.addEventListener("click", () => this.#openUploadDialog(topics));

    for (const button of this.root.querySelectorAll("[data-gallery-rename-topic]")) {
      button.addEventListener("click", async event => {
        event.stopPropagation();
        const current = button.dataset.topicName || "";
        const name = await requestTextDialog({ title: t("gallery.galleryView.renameTopic"), label: t("gallery.galleryView.topicTitle"), value: current, submitLabel: t("core.darkDialog.save") });
        if (!name || name.trim() === current.trim()) return;
        await this.#run(async () => {
          const topic = await this.gallery.renameTopic(Number(button.dataset.galleryRenameTopic), name);
          if (topic) this.#notice(t("gallery.galleryView.topicRenamed"));
        });
      });
    }
    for (const button of this.root.querySelectorAll("[data-gallery-delete-topic]")) {
      button.addEventListener("click", event => {
        event.stopPropagation();
        this.#run(async () => {
          const result = await this.gallery.deleteTopic(Number(button.dataset.galleryDeleteTopic));
          if (!result.retained && this.filterThread === String(result.threadId)) this.filterThread = "all";
          this.#notice(result.retained
            ? t("gallery.galleryView.telegramTopicDeletedLocalFolderSaved", { 0: result.assetCount })
            : t("gallery.galleryView.telegramTopicAndItsEmptyLocalFolder"));
        });
      });
    }

    this.root.querySelector("#galleryDeleteSource")?.addEventListener("change", event => {
      this.#run(() => this.gallery.setSettings({ deleteSourceAfterIndexing: event.target.checked }));
    });

    this.root.querySelector("#galleryClearThumbs")?.addEventListener("click", () => {
      this.#run(async () => {
        await this.thumbnails.clear();
        this.#notice(t("gallery.galleryView.thumbnailLinksUpdatedByteHTTPCacheIs"));
      });
    });

    this.root.querySelector("#galleryCloseDetails")?.addEventListener("click", () => {
      this.selectedId = null;
      this.queueRender();
    });

    this.root.querySelector("#galleryDeleteAsset")?.addEventListener("click", async () => {
      const id = this.selectedId;
      if (!id || !await confirmDarkDialog({
        title: t("gallery.galleryView.deleteEntryFromGallery"),
        message: t("gallery.galleryView.telegramFileIsNotDeletedInThis"),
        confirmLabel: t("core.cardDeleteConfirmation.delete"),
        danger: true
      })) return;
      this.#run(async () => {
        await this.gallery.removeAsset(id);
        this.selectedId = null;
      });
    });
  }

  #openUploadDialog(topics) {
    document.querySelector("#galleryUploadDialog")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "galleryUploadDialog";
    dialog.className = "gallery-upload-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    form.innerHTML = `
      <div class="dialog-head"><strong>${t("gallery.galleryView.uploadFilesViaBot")}</strong><button type="button" data-upload-close>×</button></div>
      <div class="gallery-upload-body">
        <label class="gallery-upload-field"><span>Topic</span>
          <select data-upload-topic>
            ${topics.map(topic => `<option value="${Number(topic.threadId)}">${escapeHtml(topic.name || `Topic ${topic.threadId}`)}</option>`).join("")}
            <option value="__new__">${t("gallery.galleryView.createNewTopic")}</option>
          </select>
        </label>
        <label class="gallery-upload-field" data-upload-new-topic ${topics.length ? "hidden" : ""}><span>${t("gallery.galleryView.newTopicTitle")}</span><input data-upload-topic-name maxlength="128" placeholder="${t("gallery.galleryView.mediaUploads")}"></label>
        <label class="gallery-upload-field"><span>${t("gallery.galleryView.captionForEachFile")}</span><textarea data-upload-caption maxlength="1024" rows="3" placeholder="${t("gallery.galleryView.theSameCaptionWillBeAddedTo")}"></textarea></label>
        <div class="gallery-upload-status" data-upload-status>${t("gallery.galleryView.firstSelectTopicAndCaptionThenFiles")}</div>
        <input data-upload-files type="file" multiple hidden>
        <div class="gallery-upload-actions"><button type="button" data-upload-cancel>${t("gallery.galleryView.cancel")}</button><button class="primary" type="button" data-upload-choose>${t("gallery.galleryView.selectFiles")}</button></div>
      </div>`;
    dialog.append(form);
    document.body.append(dialog);

    const topicSelect = dialog.querySelector("[data-upload-topic]");
    const newTopicField = dialog.querySelector("[data-upload-new-topic]");
    const topicName = dialog.querySelector("[data-upload-topic-name]");
    const caption = dialog.querySelector("[data-upload-caption]");
    const fileInput = dialog.querySelector("[data-upload-files]");
    const choose = dialog.querySelector("[data-upload-choose]");
    const cancel = dialog.querySelector("[data-upload-cancel]");
    const status = dialog.querySelector("[data-upload-status]");
    if (!topics.length) topicSelect.value = "__new__";
    const syncTopicMode = () => { newTopicField.hidden = topicSelect.value !== "__new__"; };
    topicSelect.addEventListener("change", syncTopicMode);
    syncTopicMode();
    const close = () => dialog.close();
    dialog.querySelector("[data-upload-close]")?.addEventListener("click", close);
    cancel.addEventListener("click", close);
    choose.addEventListener("click", () => {
      if (topicSelect.value === "__new__" && !topicName.value.trim()) {
        status.textContent = t("gallery.galleryView.enterNewTopicTitle");
        status.classList.add("error");
        topicName.focus();
        return;
      }
      status.classList.remove("error");
      fileInput.click();
    });

    const offProgress = this.events?.on?.("gallery:upload-progress", progress => {
      if (!dialog.isConnected) return;
      if (progress?.state === "uploading") status.textContent = t("gallery.galleryView.uploading", { 0: progress.current, 1: progress.total, 2: progress.fileName });
    });
    dialog.addEventListener("close", () => { offProgress?.(); dialog.remove(); }, { once: true });
    fileInput.addEventListener("change", async () => {
      const files = [...(fileInput.files || [])];
      if (!files.length) return;
      choose.disabled = cancel.disabled = topicSelect.disabled = topicName.disabled = caption.disabled = true;
      let threadId = Number(topicSelect.value || 0);
      try {
        if (topicSelect.value === "__new__") {
          status.textContent = t("gallery.galleryView.creatingTopic");
          const topic = await this.gallery.createTopic(topicName.value.trim());
          threadId = Number(topic.threadId);
        }
        const result = await this.gallery.uploadFiles(files, { threadId, caption: caption.value });
        this.filterThread = String(threadId);
        this.#notice(t("gallery.galleryView.uploadedFiles", { 0: result.assets.length }));
        dialog.close();
        await this.render();
      } catch (error) {
        const partial = error?.uploadResult;
        if (partial) {
          this.filterThread = String(threadId);
          dialog.close();
          await this.render();
        } else {
          choose.disabled = cancel.disabled = topicSelect.disabled = topicName.disabled = caption.disabled = false;
          fileInput.value = "";
        }
        this.#notice(error?.message || String(error), true);
      }
    });
    dialog.showModal();
  }

  #filterButton(value, label, count, active, dimension) {
    const attr = dimension === "type" ? `data-gallery-filter-type="${value}"` : `data-gallery-topic="${value}"`;
    return `<button class="gallery-filter ${active ? "active" : ""}" ${attr}><span>${label}</span><span class="gallery-filter-count">${count}</span></button>`;
  }

  #assetCard(asset, topicMap) {
    const meta = TYPE_META[asset.type] || { label: asset.type, icon: "◇" };
    const topic = topicMap.get(Number(asset.topicThreadId));
    const title = asset.caption || asset.fileName || meta.label;
    return `<article class="gallery-card ${this.selectedId === asset.id ? "selected" : ""}" data-gallery-asset="${asset.id}">
      <div class="gallery-card-media" data-gallery-thumb="${asset.id}">
        <span class="gallery-fallback-icon">${meta.icon}</span>
        ${asset.duplicateOf ? t("gallery.galleryView.duplicate") : ""}
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
        <div class="gallery-card-meta"><span>${meta.label}</span><span>${formatBytes(asset.fileSize)}</span></div>
        <div class="gallery-card-topic">${topic ? escapeHtml(topic.name) : asset.topicThreadId ? `Topic ${asset.topicThreadId}` : t("editor.editorAssetPicker.noTopic")}</div>
      </div>
    </article>`;
  }

  #details(asset, topic) {
    const meta = TYPE_META[asset.type] || { label: asset.type, icon: "◇" };
    return t("gallery.galleryView.resourceRemoveFromCatalog", { 0: asset.id, 1: meta.icon, 2: detailRow("ID", asset.id), 3: detailRow(t("gallery.galleryView.type2"), meta.label), 4: detailRow("Topic", topic?.name || (asset.topicThreadId ? `Topic ${asset.topicThreadId}` : t("editor.editorAssetPicker.noTopic"))), 5: detailRow(t("core.propertyRegistry.caption"), asset.caption || "—"), 6: detailRow(t("gallery.galleryView.fileName"), asset.fileName || "—"), 7: detailRow("MIME", asset.mimeType || "—"), 8: detailRow(t("editor.blockInspector.size"), formatBytes(asset.fileSize)), 9: detailRow(t("gallery.galleryView.frameSize"), asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"), 10: detailRow(t("gallery.galleryView.duration"), asset.duration ? t("gallery.galleryView.s", { 0: asset.duration }) : "—"), 11: detailRow("file_id", asset.telegram?.fileId || "—", true), 12: detailRow("file_unique_id", asset.telegram?.fileUniqueId || "—", true), 13: detailRow(t("gallery.galleryView.source"), asset.source?.messageDeleted ? t("gallery.galleryView.messageDeletedAfterIndexing") : asset.source?.messageId ? `message ${asset.source.messageId}` : "—"), 14: asset.duplicateOf ? detailRow(t("gallery.galleryView.duplicate2"), asset.duplicateOf, true) : "" });
  }

  async #loadThumbnails(assets, selected, generation) {
    const visible = [...assets];
    if (selected && !visible.some(asset => asset.id === selected.id)) visible.push(selected);
    await Promise.allSettled(visible.map(async asset => {
      if (!asset.telegram?.thumbnailFileId) return;
      const url = await this.thumbnails.getUrl(asset);
      if (!url || !this.root.isConnected || generation !== this.renderGeneration) return;
      for (const selector of [`[data-gallery-thumb="${cssEscape(asset.id)}"]`, `[data-gallery-thumb-detail="${cssEscape(asset.id)}"]`]) {
        const host = this.root.querySelector(selector);
        if (!host) continue;
        this.#mountThumbnail(host, asset, url, generation);
      }
    }));
  }

  #mountThumbnail(host, asset, url, generation) {
    const img = document.createElement("img");
    img.alt = asset.caption || asset.fileName || asset.type;
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.loading = "lazy";
    img.addEventListener("error", async () => {
      if (img.dataset.telegramRetry === "1" || generation !== this.renderGeneration) return;
      img.dataset.telegramRetry = "1";
      try {
        const freshUrl = await this.thumbnails.getUrl(asset, { forceRefresh: true });
        if (freshUrl && generation === this.renderGeneration) img.src = freshUrl;
      } catch (error) {
        console.warn("Telegram thumbnail refresh failed", error);
      }
    });
    img.src = url;
    host.replaceChildren(img);
  }

  async #run(action) {
    try {
      await action();
      await this.render();
    } catch (error) {
      console.error(error);
      this.#notice(error?.message || String(error), true);
    }
  }

  #notice(message, error = false) {
    if (!message) return;
    this.events?.emit("ui:toast", {
      message: String(message),
      type: error ? "error" : "info",
      duration: error ? 5200 : 3000
    });
  }

}

function countBy(items, predicate) { return items.reduce((sum, item) => sum + (predicate(item) ? 1 : 0), 0); }
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function pluralResources(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return t("gallery.galleryView.resource");
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return t("gallery.galleryView.ofResource");
  return t("gallery.galleryView.ofResources");
}
function describeFilters(type, thread, topicMap) {
  const chunks = [];
  if (type !== "all") chunks.push(TYPE_META[type]?.label || type);
  if (thread === "none") chunks.push(t("editor.editorAssetPicker.noTopic"));
  else if (thread !== "all") chunks.push(topicMap.get(Number(thread))?.name || `Topic ${thread}`);
  return chunks.length ? chunks.join(" · ") : t("gallery.galleryView.allTypesAndTopics");
}
function detailRow(label, value, code = false) {
  return `<div><dt>${label}</dt><dd class="${code ? "code" : ""}">${escapeHtml(String(value ?? "—"))}</dd></div>`;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }


function captureFocus(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active) || !active.id) return null;
  return {
    id: active.id,
    start: typeof active.selectionStart === "number" ? active.selectionStart : null,
    end: typeof active.selectionEnd === "number" ? active.selectionEnd : null
  };
}
function restoreFocus(root, state) {
  if (!state) return;
  const el = root.querySelector(`#${cssEscape(state.id)}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (state.start !== null && typeof el.setSelectionRange === "function") {
    try { el.setSelectionRange(state.start, state.end ?? state.start); } catch {}
  }
}
