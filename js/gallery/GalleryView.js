import { confirmDarkDialog, requestTextDialog } from "../core/DarkDialog.js?v=1.6.5";

const TYPE_META = Object.freeze({
  photo: { label: "Фото", icon: "▧" },
  video: { label: "Видео", icon: "▶" },
  audio: { label: "Аудио", icon: "♪" },
  voice: { label: "Голосовые", icon: "◖" },
  document: { label: "Файлы", icon: "▤" }
});

export class GalleryView {
  constructor({ root, gallery, thumbnails, events, layoutPreferences = null }) {
    this.root = root;
    this.gallery = gallery;
    this.thumbnails = thumbnails;
    this.events = events;
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
      this.#notice(`Ресурс сохранён, но исходное сообщение удалить не удалось: ${error?.message || error}`, true);
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
          <h1>Галерея</h1>
          <p>Telegram хранит оригиналы; здесь находятся только metadata и file_id. Миниатюры отображаются напрямую из Telegram и кэшируются браузером.</p>
        </div>
        <div class="gallery-header-stats">
          <span>${allAssets.length} ресурсов</span>
          <span>${cacheStats.count} thumbnail URL · browser cache</span>
        </div>
      </div>

      <div class="gallery-toolbar">
        <input id="gallerySearch" class="gallery-search" placeholder="Поиск по подписи, имени, topic…" value="${escapeAttr(this.search)}">
        <button class="primary" id="galleryUploadFiles">＋ Загрузить файлы</button>
        <button id="galleryNewTopic">＋ Topic</button>
        <label class="gallery-toggle"><input id="galleryDeleteSource" type="checkbox" ${settings.deleteSourceAfterIndexing ? "checked" : ""}> Удалять сообщение после индексирования</label>
        <button id="galleryClearThumbs">Обновить миниатюры</button>
      </div>

      <div class="gallery-layout">
        <aside class="gallery-sidebar">
          <div class="gallery-side-section">
            <div class="gallery-side-title">Тип</div>
            ${this.#filterButton("all", "Все", allAssets.length, this.filterType === "all", "type")}
            ${Object.entries(TYPE_META).map(([type, meta]) => this.#filterButton(type, `${meta.icon} ${meta.label}`, countBy(allAssets, a => a.type === type), this.filterType === type, "type")).join("")}
          </div>

          <div class="gallery-side-section gallery-topic-section">
            <div class="gallery-side-title">Топики</div>
            ${this.#filterButton("all", "Все", allAssets.length, this.filterThread === "all", "topic")}
            ${this.#filterButton("none", "Без топика", countBy(allAssets, a => !a.topicThreadId), this.filterThread === "none", "topic")}
            <div class="gallery-topic-list">
              ${topics.map(topic => {
                const count = countBy(allAssets, a => Number(a.topicThreadId) === Number(topic.threadId));
                return `<div class="gallery-topic-line ${this.filterThread == topic.threadId ? "active" : ""} ${topic.telegramDeleted ? "local-only" : ""}">
                  <button class="gallery-topic-select" data-gallery-topic="${topic.threadId}" title="${escapeAttr(topic.name)}">
                    <span class="gallery-topic-name">${topic.systemRole === "preview" ? "◆ " : ""}${escapeHtml(topic.name || `Topic ${topic.threadId}`)}</span>
                    <span class="gallery-filter-count">${count}</span>
                  </button>
                  ${topic.telegramDeleted ? "" : `<button class="gallery-topic-delete" data-gallery-delete-topic="${topic.threadId}" title="Удалить topic">🗑</button>`}
                  <button class="gallery-topic-rename" data-gallery-rename-topic="${topic.threadId}" data-topic-name="${escapeAttr(topic.name || "")}" title="Переименовать">✎</button>
                </div>`;
              }).join("")}
            </div>
          </div>
        </aside>

        <div class="layout-splitter gallery-splitter" data-gallery-splitter="left" title="Изменить ширину фильтров"></div>

        <section class="gallery-content">
          <div class="gallery-content-head">
            <strong>${filtered.length} ${pluralResources(filtered.length)}</strong>
            <span>${describeFilters(this.filterType, this.filterThread, topicMap)}</span>
          </div>
          <div id="galleryGrid" class="gallery-grid">
            ${filtered.length ? filtered.map(asset => this.#assetCard(asset, topicMap)).join("") : `<div class="gallery-empty"><strong>Здесь пока пусто</strong><span>Отправьте владельцем фото, видео, аудио, voice или документ боту.</span></div>`}
          </div>
        </section>

        <div class="layout-splitter gallery-splitter" data-gallery-splitter="right" title="Изменить ширину свойств ресурса"></div>

        <aside class="gallery-details ${selected ? "visible" : ""}" id="galleryDetails">
          ${selected ? this.#details(selected, topicMap.get(Number(selected.topicThreadId))) : `<div class="gallery-details-empty">Выберите ресурс</div>`}
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
      const name = await requestTextDialog({ title: "Новый topic", label: "Название topic", submitLabel: "Создать" });
      if (!name) return;
      await this.#run(async () => {
        const topic = await this.gallery.createTopic(name);
        this.filterThread = String(topic.threadId);
        this.#notice(`Topic «${topic.name}» создан`);
      });
    });
    this.root.querySelector("#galleryUploadFiles")?.addEventListener("click", () => this.#openUploadDialog(topics));

    for (const button of this.root.querySelectorAll("[data-gallery-rename-topic]")) {
      button.addEventListener("click", async event => {
        event.stopPropagation();
        const current = button.dataset.topicName || "";
        const name = await requestTextDialog({ title: "Переименовать topic", label: "Название topic", value: current, submitLabel: "Сохранить" });
        if (!name || name.trim() === current.trim()) return;
        await this.#run(async () => {
          const topic = await this.gallery.renameTopic(Number(button.dataset.galleryRenameTopic), name);
          if (topic) this.#notice("Topic переименован");
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
            ? `Telegram topic удалён; локальная папка сохранена (${result.assetCount})`
            : "Telegram topic и его пустая локальная папка удалены");
        });
      });
    }

    this.root.querySelector("#galleryDeleteSource")?.addEventListener("change", event => {
      this.#run(() => this.gallery.setSettings({ deleteSourceAfterIndexing: event.target.checked }));
    });

    this.root.querySelector("#galleryClearThumbs")?.addEventListener("click", () => {
      this.#run(async () => {
        await this.thumbnails.clear();
        this.#notice("Ссылки миниатюр обновлены. Байтовым HTTP-кэшем управляет браузер.");
      });
    });

    this.root.querySelector("#galleryCloseDetails")?.addEventListener("click", () => {
      this.selectedId = null;
      this.queueRender();
    });

    this.root.querySelector("#galleryDeleteAsset")?.addEventListener("click", async () => {
      const id = this.selectedId;
      if (!id || !await confirmDarkDialog({
        title: "Удалить запись из Gallery?",
        message: "Telegram-файл при этом не удаляется.",
        confirmLabel: "Удалить",
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
      <div class="dialog-head"><strong>Загрузить файлы через бота</strong><button type="button" data-upload-close>×</button></div>
      <div class="gallery-upload-body">
        <label class="gallery-upload-field"><span>Topic</span>
          <select data-upload-topic>
            ${topics.map(topic => `<option value="${Number(topic.threadId)}">${escapeHtml(topic.name || `Topic ${topic.threadId}`)}</option>`).join("")}
            <option value="__new__">＋ Создать новый topic</option>
          </select>
        </label>
        <label class="gallery-upload-field" data-upload-new-topic ${topics.length ? "hidden" : ""}><span>Название нового topic</span><input data-upload-topic-name maxlength="128" placeholder="Media uploads"></label>
        <label class="gallery-upload-field"><span>Caption для каждого файла</span><textarea data-upload-caption maxlength="1024" rows="3" placeholder="Одинаковая подпись будет добавлена к каждому сообщению"></textarea></label>
        <div class="gallery-upload-status" data-upload-status>Сначала выберите topic и caption, затем файлы.</div>
        <input data-upload-files type="file" multiple hidden>
        <div class="gallery-upload-actions"><button type="button" data-upload-cancel>Отмена</button><button class="primary" type="button" data-upload-choose>Выбрать файлы…</button></div>
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
        status.textContent = "Введите название нового topic";
        status.classList.add("error");
        topicName.focus();
        return;
      }
      status.classList.remove("error");
      fileInput.click();
    });

    const offProgress = this.events?.on?.("gallery:upload-progress", progress => {
      if (!dialog.isConnected) return;
      if (progress?.state === "uploading") status.textContent = `Загрузка ${progress.current}/${progress.total}: ${progress.fileName}`;
    });
    dialog.addEventListener("close", () => { offProgress?.(); dialog.remove(); }, { once: true });
    fileInput.addEventListener("change", async () => {
      const files = [...(fileInput.files || [])];
      if (!files.length) return;
      choose.disabled = cancel.disabled = topicSelect.disabled = topicName.disabled = caption.disabled = true;
      let threadId = Number(topicSelect.value || 0);
      try {
        if (topicSelect.value === "__new__") {
          status.textContent = "Создание topic…";
          const topic = await this.gallery.createTopic(topicName.value.trim());
          threadId = Number(topic.threadId);
        }
        const result = await this.gallery.uploadFiles(files, { threadId, caption: caption.value });
        this.filterThread = String(threadId);
        this.#notice(`Загружено файлов: ${result.assets.length}`);
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
        ${asset.duplicateOf ? `<span class="gallery-badge duplicate" title="Этот Telegram file_unique_id уже встречался">дубль</span>` : ""}
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
        <div class="gallery-card-meta"><span>${meta.label}</span><span>${formatBytes(asset.fileSize)}</span></div>
        <div class="gallery-card-topic">${topic ? escapeHtml(topic.name) : asset.topicThreadId ? `Topic ${asset.topicThreadId}` : "Без топика"}</div>
      </div>
    </article>`;
  }

  #details(asset, topic) {
    const meta = TYPE_META[asset.type] || { label: asset.type, icon: "◇" };
    return `<div class="gallery-details-head"><strong>Ресурс</strong><button id="galleryCloseDetails">×</button></div>
      <div class="gallery-details-preview" data-gallery-thumb-detail="${asset.id}"><span class="gallery-fallback-icon large">${meta.icon}</span></div>
      <dl class="gallery-meta-list">
        ${detailRow("ID", asset.id)}
        ${detailRow("Тип", meta.label)}
        ${detailRow("Topic", topic?.name || (asset.topicThreadId ? `Topic ${asset.topicThreadId}` : "Без топика"))}
        ${detailRow("Подпись", asset.caption || "—")}
        ${detailRow("Имя файла", asset.fileName || "—")}
        ${detailRow("MIME", asset.mimeType || "—")}
        ${detailRow("Размер", formatBytes(asset.fileSize))}
        ${detailRow("Размер кадра", asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—")}
        ${detailRow("Длительность", asset.duration ? `${asset.duration} с` : "—")}
        ${detailRow("file_id", asset.telegram?.fileId || "—", true)}
        ${detailRow("file_unique_id", asset.telegram?.fileUniqueId || "—", true)}
        ${detailRow("Источник", asset.source?.messageDeleted ? "Сообщение удалено после индексации" : asset.source?.messageId ? `message ${asset.source.messageId}` : "—")}
        ${asset.duplicateOf ? detailRow("Дубликат", asset.duplicateOf, true) : ""}
      </dl>
      <button id="galleryDeleteAsset" class="gallery-danger">Удалить из каталога</button>`;
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
  if (mod10 === 1 && mod100 !== 11) return "ресурс";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "ресурса";
  return "ресурсов";
}
function describeFilters(type, thread, topicMap) {
  const chunks = [];
  if (type !== "all") chunks.push(TYPE_META[type]?.label || type);
  if (thread === "none") chunks.push("Без топика");
  else if (thread !== "all") chunks.push(topicMap.get(Number(thread))?.name || `Topic ${thread}`);
  return chunks.length ? chunks.join(" · ") : "Все типы и topics";
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
