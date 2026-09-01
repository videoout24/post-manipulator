import { t } from "../i18n/index.js?v=1.8.0";
import { randomUUID } from "../core/Random.js?v=1.5.9";

const ASSET_PREFIX = "asset_";
const TOPIC_PREFIX = "gallery:";

export class GalleryStore {
  constructor({ db, events = null }) {
    this.db = db;
    this.events = events;
  }

  async ingest(media) {
    if (!media?.type || !media?.fileId) throw new Error(t("gallery.galleryStore.galleryMediaEventDoesNotContainType"));
    const sourceEventKey = media.source?.chatId && media.source?.messageId
      ? `${Number(media.source.chatId)}:${Number(media.source.messageId)}`
      : null;
    if (sourceEventKey) {
      const existing = await this.findBySourceEventKey(sourceEventKey);
      if (existing) {
        this.events?.emit("gallery:asset-replayed", existing);
        return existing;
      }
    }
    const fileUniqueId = String(media.fileUniqueId || "");
    const duplicate = fileUniqueId ? await this.findFirstByFileUniqueId(fileUniqueId) : null;
    const id = `${ASSET_PREFIX}${media.type}_${randomUUID()}`;
    const asset = {
      id,
      type: media.type,
      sourceEventKey,
      telegram: {
        fileId: media.fileId,
        fileUniqueId: fileUniqueId || null,
        thumbnailFileId: media.thumbnailFileId || null
      },
      topicThreadId: media.source?.threadId ? Number(media.source.threadId) : null,
      caption: String(media.caption || ""),
      fileName: String(media.fileName || ""),
      mimeType: String(media.mimeType || ""),
      fileSize: finiteOrNull(media.fileSize),
      duration: finiteOrNull(media.duration),
      width: finiteOrNull(media.width),
      height: finiteOrNull(media.height),
      source: {
        chatId: finiteOrNull(media.source?.chatId),
        messageId: finiteOrNull(media.source?.messageId),
        threadId: finiteOrNull(media.source?.threadId),
        messageDeleted: false,
        deleteError: null
      },
      telegramDate: media.date || null,
      duplicateOf: duplicate?.id || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.db.put("gallery", id, asset);
    this.events?.emit("gallery:asset-added", asset);
    return asset;
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) return null;
    const next = deepMerge(current, patch);
    next.updatedAt = Date.now();
    await this.db.put("gallery", id, next);
    this.events?.emit("gallery:asset-updated", next);
    return next;
  }

  get(id) { return this.db.get("gallery", id, null); }

  async remove(id) {
    await this.db.delete("gallery", id);
    this.events?.emit("gallery:asset-removed", { id });
  }

  async list({ type = null, threadId = undefined } = {}) {
    let rows;
    if (type) rows = await this.db.indexAll("gallery", "byType", type);
    else if (threadId !== undefined && threadId !== null) rows = await this.db.indexAll("gallery", "byThreadId", Number(threadId));
    else rows = await this.db.all("gallery");
    let assets = rows.map(row => row.value);
    if (threadId === null) assets = assets.filter(asset => !asset.topicThreadId);
    else if (threadId !== undefined && threadId !== null && type) assets = assets.filter(asset => Number(asset.topicThreadId) === Number(threadId));
    assets.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return assets;
  }

  async findFirstByFileUniqueId(fileUniqueId) {
    if (!fileUniqueId) return null;
    const rows = await this.db.indexAll("gallery", "byFileUniqueId", fileUniqueId);
    return rows[0]?.value || null;
  }

  async findBySourceEventKey(sourceEventKey) {
    if (!sourceEventKey) return null;
    const rows = await this.db.indexAll("gallery", "bySourceEventKey", sourceEventKey);
    return rows[0]?.value || null;
  }

  async upsertTopic(topic) {
    const threadId = Number(topic?.threadId || 0);
    if (!threadId) return null;
    const key = `${TOPIC_PREFIX}${threadId}`;
    const current = await this.db.get("topics", key, null);
    const next = {
      id: key,
      threadId,
      chatId: Number(topic.chatId || current?.chatId || 0) || null,
      name: String(topic.name || current?.name || `Topic ${threadId}`),
      iconColor: topic.iconColor ?? current?.iconColor ?? null,
      iconCustomEmojiId: topic.iconCustomEmojiId ?? current?.iconCustomEmojiId ?? null,
      source: topic.source || current?.source || "observed",
      systemRole: topic.systemRole || current?.systemRole || null,
      telegramDeleted: topic.telegramDeleted ?? current?.telegramDeleted ?? false,
      createdAt: current?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await this.db.put("topics", key, next);
    this.events?.emit("gallery:topic-updated", next);
    return next;
  }

  async ensureTopicPlaceholder(threadId, chatId = null) {
    const id = Number(threadId || 0);
    if (!id) return null;
    const existing = await this.getTopic(id);
    if (existing) return existing;
    return this.upsertTopic({ threadId: id, chatId, name: `Topic ${id}`, source: "media" });
  }

  getTopic(threadId) { return this.db.get("topics", `${TOPIC_PREFIX}${Number(threadId)}`, null); }

  async markTopicDeleted(threadId) {
    const current = await this.getTopic(threadId);
    if (!current) return null;
    return this.upsertTopic({ ...current, telegramDeleted: true, source: "local-folder" });
  }

  async removeTopic(threadId) {
    const id = Number(threadId || 0);
    if (!id) return false;
    await this.db.delete("topics", `${TOPIC_PREFIX}${id}`);
    this.events?.emit("gallery:topic-removed", { threadId: id });
    return true;
  }

  async listTopics() {
    const rows = await this.db.all("topics");
    return rows
      .filter(row => row.key.startsWith(TOPIC_PREFIX))
      .map(row => row.value)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  }
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function deepMerge(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && target?.[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      out[key] = deepMerge(target[key], value);
    } else out[key] = value;
  }
  return out;
}
