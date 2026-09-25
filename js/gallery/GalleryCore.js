import { t } from "../i18n/index.js?v=1.12.6";
import { isBlobLike } from "../core/FileDrop.js?v=1.12.8";
const SETTINGS_KEY = "gallerySettings";
let uploadSequence = 0;
const DEFAULT_SETTINGS = Object.freeze({
  deleteSourceAfterIndexing: false
});

export class GalleryCore {
  constructor({ db, events, telegramCore, client, store, thumbnails, projects = null, drafts = null, tree = null, projectSession = null, draftSession = null }) {
    this.db = db;
    this.events = events;
    this.telegramCore = telegramCore;
    this.client = client;
    this.store = store;
    this.thumbnails = thumbnails;
    this.projects = projects;
    this.drafts = drafts;
    this.tree = tree;
    this.projectSession = projectSession;
    this.draftSession = draftSession;
    this.unsubscribers = [];
  }

  start() {
    if (this.unsubscribers.length) return;
    this.unsubscribers.push(
      this.telegramCore.media.onReceived(media => this.ingest(media)),
      this.telegramCore.media.onCollaborationReceived?.(media => this.ingestCollaborationMedia(media)),
      this.telegramCore.topics.onObserved(topic => this.observeTopic(topic))
    );
  }

  stop() {
    for (const off of this.unsubscribers.splice(0)) off?.();
  }

  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...(await this.db.get("settings", SETTINGS_KEY, {})) };
  }

  async setSettings(patch) {
    const next = { ...(await this.getSettings()), ...patch };
    await this.db.put("settings", SETTINGS_KEY, next);
    this.events?.emit("gallery:settings", next);
    return next;
  }

  async ingest(media) {
    let asset;
    try {
      if (media?.source?.threadId) await this.store.ensureTopicPlaceholder(media.source.threadId, media.source.chatId);
      asset = await this.store.ingest(media);
    } catch (error) {
      error.retryTelegramUpdate = true;
      throw error;
    }

    const settings = await this.getSettings();
    if (settings.deleteSourceAfterIndexing && !media?.skipSourceDeletion && !asset.source?.messageDeleted && asset.source?.chatId && asset.source?.messageId) {
      try {
        await this.client.deleteMessage(asset.source.chatId, asset.source.messageId);
        asset = await this.store.update(asset.id, { source: { messageDeleted: true, deleteError: null } });
      } catch (error) {
        asset = await this.store.update(asset.id, {
          source: { messageDeleted: false, deleteError: { message: error?.message || String(error), code: error?.errorCode || 0 } }
        });
        this.events?.emit("gallery:source-delete-error", { asset, error });
      }
    }

    this.events?.emit("gallery:ingested", asset);
    return asset;
  }

  async ingestCollaborationMedia(media) {
    try {
      return await this.#ingestCollaborationMedia(media);
    } catch (error) {
      error.retryTelegramUpdate = true;
      throw error;
    }
  }

  async #ingestCollaborationMedia(media) {
    if (!media?.sourceEventKey) throw new Error("Collaborative media is missing a stable source event key");
    const existing = await this.store.findBySourceEventKey(media.sourceEventKey);
    if (existing) return existing;
    const settings = await this.getSettings();
    const originSource = structuredClone(media.source || null);
    let indexedMedia = { ...media, originSource, skipSourceDeletion: true };
    const transferKey = `collaborationMediaCopy:${media.sourceEventKey}`;
    const pendingTransfer = await this.db.get("runtime", transferKey, null);

    // When source retention is enabled, give every collaborator bot its own
    // private owner topic. Rich Message media are materialized one block at a
    // time; ordinary media posts can be copied as-is.
    if (pendingTransfer?.source?.messageId) {
      indexedMedia = { ...indexedMedia, source: structuredClone(pendingTransfer.source) };
    } else if (!settings.deleteSourceAfterIndexing) {
      const owner = await this.telegramCore.owner.getOwner();
      if (!owner?.chatId) throw new Error(t("gallery.galleryCore.firstLinkATelegramOwner"));
      const topic = await this.#collaborationTopic(media.bot, owner.chatId);
      const stored = media.separate
        ? await this.client.sendStoredMedia({
          chatId: owner.chatId,
          messageThreadId: topic.threadId,
          type: media.type,
          fileId: media.fileId,
          caption: media.caption || ""
        })
        : await this.client.copyMessage({
          chatId: owner.chatId,
          fromChatId: media.source?.chatId,
          messageId: media.source?.messageId,
          messageThreadId: topic.threadId
        });
      const retainedSource = {
        chatId: Number(owner.chatId),
        messageId: Number(stored?.message_id || 0),
        threadId: Number(topic.threadId)
      };
      if (!retainedSource.messageId) throw new Error("Telegram did not return message_id for retained collaborative media");
      await this.db.put("runtime", transferKey, { source: retainedSource, createdAt: Date.now() });
      indexedMedia = {
        ...indexedMedia,
        source: retainedSource
      };
    }
    const asset = await this.ingest(indexedMedia);
    if (pendingTransfer || !settings.deleteSourceAfterIndexing) await this.db.delete("runtime", transferKey);
    return asset;
  }

  async #collaborationTopic(bot, ownerChatId) {
    const botId = Number(bot?.id || 0);
    if (!botId) throw new Error("Collaborator bot identity is missing");
    const systemRole = `collaboration-bot:${botId}`;
    const existing = (await this.store.listTopics()).find(topic => topic.systemRole === systemRole && !topic.telegramDeleted);
    if (existing) return existing;
    const name = bot?.username ? `@${bot.username}` : [bot?.firstName, bot?.lastName].filter(Boolean).join(" ") || `Bot ${botId}`;
    const created = await this.telegramCore.topics.create(name);
    return this.store.upsertTopic({
      ...created,
      chatId: Number(ownerChatId),
      name,
      source: "collaboration",
      systemRole,
      telegramDeleted: false
    });
  }

  async observeTopic(topic) {
    if (!topic?.threadId) return null;
    return this.store.upsertTopic({
      ...topic,
      source: "telegram",
      telegramDeleted: false
    });
  }

  async createTopic(name) {
    const topic = await this.telegramCore.topics.create(name);
    return this.store.upsertTopic({ ...topic, source: "gallery", telegramDeleted: false });
  }

  async renameTopic(threadId, name) {
    const topic = await this.telegramCore.topics.rename(threadId, name);
    if (!topic) return null;
    return this.store.upsertTopic({ ...topic, source: "gallery" });
  }

  async getTopicDeletionInfo(threadId) {
    const id = Number(threadId || 0);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(t("gallery.galleryCore.invalidMessageThreadId"));
    const [topic, assets] = await Promise.all([this.store.getTopic(id), this.store.list({ threadId: id })]);
    if (!topic) throw new Error(t("gallery.topicDelete.notFound"));
    return { threadId: id, topic, assets, assetCount: assets.length, hasRemote: !topic.telegramDeleted };
  }

  async deleteTopic(threadId, { deleteFromBot = false, deleteFromEditor = false } = {}) {
    let info = await this.getTopicDeletionInfo(threadId);
    const id = info.threadId;
    const removeRemote = deleteFromBot && info.hasRemote;
    if (!removeRemote && !deleteFromEditor) throw new Error(t("gallery.topicDelete.chooseScope"));

    // Check every index before touching Telegram or the local folder. A used
    // asset must not cause a partially deleted topic.
    if (deleteFromEditor) await this.#assertTopicAssetsUnused(info.assets);
    let remote = null;
    if (removeRemote) {
      remote = await this.telegramCore.topics.delete(id);
      await this.store.markTopicDeleted(id);
      // Uploads/updates may have arrived while the Telegram request was pending.
      info = await this.getTopicDeletionInfo(id);
    }
    if (deleteFromEditor) {
      await this.#assertTopicAssetsUnused(info.assets);
      await this.store.removeTopicAndAssets(id, info.assets);
      await Promise.all(info.assets.map(asset => this.thumbnails.remove(asset.id)));
    }
    return {
      threadId: id,
      retained: !deleteFromEditor,
      assetCount: info.assetCount,
      topic: deleteFromEditor ? null : info.topic,
      deletedFromBot: removeRemote,
      deletedFromEditor: deleteFromEditor,
      alreadyMissing: !!remote?.alreadyMissing
    };
  }

  async #assertTopicAssetsUnused(assets) {
    for (const asset of assets) {
      const usages = await this.findAssetUsages(asset.id);
      if (usages.length) throw new GalleryAssetInUseError(asset.id, usages);
    }
  }

  async uploadFiles(files, { threadId, caption = "" } = {}) {
    const selected = [...(files || [])].filter(isBlobLike);
    if (!selected.length) throw new Error(t("gallery.galleryCore.selectAtLeastOneFile"));
    const owner = await this.telegramCore.owner.getOwner();
    if (!owner?.chatId) throw new Error(t("gallery.galleryCore.firstLinkATelegramOwner"));
    const topicId = Number(threadId || 0);
    if (!topicId) throw new Error(t("gallery.galleryCore.selectATopicForUpload"));
    const normalizedCaption = String(caption || "").trim();
    if ([...normalizedCaption].length > 1024) throw new Error(t("gallery.galleryCore.captionMustNotExceed1024Characters"));

    const assets = [];
    const failures = [];
    const uploadId = ++uploadSequence;
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      try {
        this.events?.emit("gallery:upload-progress", { uploadId, state: "uploading", current: index + 1, total: selected.length, fileName: file.name || "file" });
        const message = await this.client.uploadMedia({
          chatId: Number(owner.chatId),
          messageThreadId: topicId,
          file,
          caption: normalizedCaption
        });
        const media = extractOwnerMedia(message);
        if (!media) throw new Error(t("gallery.galleryCore.telegramDidNotReturnASupportedMedia"));
        const asset = await this.ingest({
          ...media,
          source: {
            chatId: Number(message.chat?.id || owner.chatId),
            messageId: Number(message.message_id),
            threadId: Number(message.message_thread_id || topicId)
          },
          caption: message.caption || normalizedCaption,
          date: message.date || null
        });
        assets.push(asset);
      } catch (error) {
        failures.push({ fileName: file.name || "file", error, message: error?.message || String(error) });
      }
    }
    const result = { assets, failures, total: selected.length };
    this.events?.emit("gallery:upload-progress", { uploadId, state: failures.length ? "partial" : "complete", ...result });
    if (failures.length) {
      const error = new Error(t("gallery.galleryCore.uploadedOfErrors", { 0: assets.length, 1: selected.length, 2: failures.length }));
      error.uploadResult = result;
      throw error;
    }
    return result;
  }

  async getAsset(id) { return this.store.get(id); }
  async listAssets(filters) { return this.store.list(filters); }
  async removeAsset(id) {
    const usages = await this.findAssetUsages(id);
    if (usages.length) throw new GalleryAssetInUseError(id, usages);
    await this.store.remove(id);
    await this.thumbnails.remove(id);
  }

  async findAssetUsages(id) {
    const galleryId = String(id || "");
    if (!galleryId) return [];
    const usages = [];
    const seen = new Set();
    const add = usage => {
      const key = `${usage.kind}:${usage.projectId || ""}:${usage.postId || ""}:${usage.draftId || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      usages.push(usage);
    };

    for (const project of await this.projects?.listProjects?.() || []) {
      for (const post of project.posts || []) {
        if (!astUsesGalleryAsset(post.messageAst, galleryId)) continue;
        add({
          kind: post.publication?.state === "published" ? "published" : "project",
          projectId: project.id,
          projectTitle: project.title,
          postId: post.id,
          postTitle: post.title
        });
      }
    }
    for (const draft of await this.drafts?.list?.() || []) {
      if (astUsesGalleryAsset(draft.messageAst, galleryId)) {
        add({ kind: "draft", draftId: draft.id, draftTitle: draft.title });
      }
    }

    const liveAst = this.tree?.toJSON?.();
    if (liveAst && astUsesGalleryAsset(liveAst, galleryId)) {
      if (this.projectSession?.isProjectActive?.()) {
        add({
          kind: "project",
          projectId: this.projectSession.activeProjectId,
          projectTitle: this.projectSession.project?.title || t("gallery.galleryCore.openProject"),
          postId: this.projectSession.activePostId,
          postTitle: this.projectSession.project?.posts?.find(post => post.id === this.projectSession.activePostId)?.title || t("gallery.galleryCore.openPost")
        });
      } else if (this.draftSession?.isActive?.()) {
        add({
          kind: "draft",
          draftId: this.draftSession.activeDraftId,
          draftTitle: this.draftSession.draft?.title || t("gallery.galleryCore.openDraft")
        });
      } else add({ kind: "editor" });
    }
    return usages;
  }
  async resolveTelegramFile(id, { acceptedTypes = null } = {}) {
    const asset = await this.getAsset(id);
    if (!asset) throw new Error(`Gallery resource not found: ${id}`);
    if (acceptedTypes?.length && !acceptedTypes.includes(asset.type)) {
      throw new Error(`Gallery resource ${id} has type ${asset.type}; expected ${acceptedTypes.join(", ")}`);
    }
    if (!asset.telegram?.fileId) throw new Error(`Gallery resource ${id} has no Telegram file_id`);
    return { asset, fileId: asset.telegram.fileId };
  }

  async listTopics() {
    const topics = await this.store.listTopics();
    return topics.filter(topic => topic.systemRole !== "preview");
  }
}

export class GalleryAssetInUseError extends Error {
  constructor(assetId, usages) {
    const details = usages.map(describeAssetUsage).join(", ");
    super(t("gallery.galleryCore.cannotDeleteMediaItIsUsed", { 0: details }));
    this.name = "GalleryAssetInUseError";
    this.assetId = assetId;
    this.usages = structuredClone(usages);
  }
}

function astUsesGalleryAsset(ast, galleryId) {
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (String(node.props?.galleryId || "") === galleryId) return true;
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return false;
}

function describeAssetUsage(usage) {
  if (usage.kind === "published") return t("gallery.galleryCore.publishedPostOfProject", { 0: usage.postTitle || usage.postId, 1: usage.projectTitle || usage.projectId });
  if (usage.kind === "project") return t("gallery.galleryCore.postOfProject", { 0: usage.postTitle || usage.postId, 1: usage.projectTitle || usage.projectId });
  if (usage.kind === "draft") return t("gallery.galleryCore.draft", { 0: usage.draftTitle || usage.draftId });
  return t("gallery.galleryCore.currentEditorDocument");
}
import { extractOwnerMedia } from "../telegram/TelegramRuntime.js?v=1.12.1";
