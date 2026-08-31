const DEFAULT_URL_TTL_MS = 50 * 60 * 1000;

// Browser-only Telegram thumbnail resolver.
// Telegram's /file/bot... endpoint can be embedded in <img>, but it does not
// expose CORS headers for JS fetch(), so persistent Blob caching is intentionally
// not used here. The browser HTTP cache handles image bytes; we only cache the
// short-lived resolved file URL in memory.
export class ThumbnailCache {
  constructor({ db = null, client, events = null, urlTtlMs = DEFAULT_URL_TTL_MS }) {
    this.db = db; // retained for constructor/API compatibility; no Blob writes.
    this.client = client;
    this.events = events;
    this.urlTtlMs = urlTtlMs;
    this.entries = new Map();
    this.pending = new Map();
    // Telegram file URLs contain the bot token. A same-bot token rotation keeps
    // Gallery metadata intact but every cached URL must be resolved again.
    this.events?.on("telegram:token-rotated", () => this.clear().catch(() => {}));
  }

  async getUrl(asset, { forceRefresh = false } = {}) {
    const galleryId = asset?.id;
    const fileId = asset?.telegram?.thumbnailFileId;
    if (!galleryId || !fileId || !this.client.hasToken()) return null;

    const cached = this.entries.get(galleryId);
    if (!forceRefresh && cached?.sourceFileId === fileId && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    if (!forceRefresh && this.pending.has(galleryId)) return this.pending.get(galleryId);
    const promise = this.#resolve(galleryId, fileId).finally(() => this.pending.delete(galleryId));
    this.pending.set(galleryId, promise);
    return promise;
  }

  invalidate(galleryId) {
    if (!galleryId) return;
    this.entries.delete(galleryId);
  }

  async remove(galleryId) { this.invalidate(galleryId); }

  async clear() {
    this.entries.clear();
    this.pending.clear();
    this.events?.emit("gallery:thumbnail-cache-cleared", { mode: "url-memory" });
  }

  async stats() {
    return {
      count: this.entries.size,
      bytes: null,
      mode: "browser-http",
      persistent: false
    };
  }

  async #resolve(galleryId, fileId) {
    const file = await this.client.getFile(fileId);
    if (!file?.file_path) return null;
    const url = this.client.buildFileUrl(file.file_path);
    this.entries.set(galleryId, {
      sourceFileId: fileId,
      url,
      resolvedAt: Date.now(),
      expiresAt: Date.now() + this.urlTtlMs
    });
    this.events?.emit("gallery:thumbnail-url-resolved", { galleryId });
    return url;
  }
}
