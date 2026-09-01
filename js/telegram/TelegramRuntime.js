import { t } from "../i18n/index.js?v=1.8.0";
import { TelegramApiError } from "./TelegramClient.js?v=1.5.9";
import { randomUUID } from "../core/Random.js?v=1.5.9";

const OFFSET_KEY = "telegramOffset";
const MEDIA_SETTINGS_KEY = "acceptedOwnerMedia";
const DEFAULT_MEDIA_SETTINGS = Object.freeze({
  photo: true,
  video: true,
  audio: true,
  voice: true,
  document: true
});

export class TelegramRuntime {
  constructor({ db, events, client, ownerBinding, previewChannelBinding, publicationTargets = null, publications = null, serviceMessages = null, botIdentity }) {
    this.db = db;
    this.events = events;
    this.client = client;
    this.ownerBinding = ownerBinding;
    this.previewChannelBinding = previewChannelBinding;
    this.publicationTargets = publicationTargets;
    this.publications = publications;
    this.serviceMessages = serviceMessages;
    this.botIdentity = botIdentity;
    this.running = false;
    this.abortController = null;
    this.loopPromise = null;
    this.startPromise = null;
    this.bot = null;
    this.status = { state: "stopped", message: t("telegram.telegramRuntime.stopped") };
  }

  getStatus() { return { ...this.status, running: this.running, bot: this.bot ? { ...this.bot } : null }; }

  async start() {
    if (this.running) return this.getStatus();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startRuntime();
    try { return await this.startPromise; }
    finally { this.startPromise = null; }
  }

  async #startRuntime() {
    this.#setStatus("starting", t("telegram.telegramRuntime.checkingTelegram"));
    try {
      this.bot = this.botIdentity
        ? await this.botIdentity.verifyCurrentClient()
        : await this.client.getMe();
      const webhook = await this.client.getWebhookInfo();
      if (webhook?.url) {
        this.#setStatus("error", t("telegram.telegramRuntime.theBotHasAnActiveWebhookDisable"), { webhookUrl: webhook.url });
        throw new TelegramApiError(t("telegram.telegramRuntime.getupdatesIsUnavailableWhileWebhookIsSet"), {
          method: "getUpdates",
          errorCode: 409,
          description: `Active webhook: ${webhook.url}`
        });
      }

      this.running = true;
      this.abortController = new AbortController();
      this.#setStatus("running", `Long polling: @${this.bot.username || this.bot.id}`);

      this.loopPromise = this.#pollLoop(this.abortController.signal);
      return this.getStatus();
    } catch (error) {
      if (this.status.state !== "error") this.#setStatus("error", error?.message || t("telegram.telegramRuntime.failedToStartTelegramRuntime"), { error });
      throw error;
    }
  }

  async stop() {
    if (!this.running && !this.loopPromise) {
      this.#setStatus("stopped", t("telegram.telegramRuntime.stopped"));
      return;
    }
    this.running = false;
    this.abortController?.abort();
    try { await this.loopPromise; } catch { /* loop reports its own errors */ }
    this.loopPromise = null;
    this.abortController = null;
    this.#setStatus("stopped", t("telegram.telegramRuntime.stopped"));
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async clearWebhook() {
    return this.client.deleteWebhook({ dropPendingUpdates: false });
  }

  async resetOffset() {
    await this.db.delete("runtime", OFFSET_KEY);
    this.events?.emit("telegram:offset", { offset: 0 });
  }

  async getMediaSettings() {
    return { ...DEFAULT_MEDIA_SETTINGS, ...(await this.db.get("settings", MEDIA_SETTINGS_KEY, {})) };
  }

  async setMediaSettings(settings) {
    const next = { ...DEFAULT_MEDIA_SETTINGS, ...settings };
    await this.db.put("settings", MEDIA_SETTINGS_KEY, next);
    this.events?.emit("telegram:media-settings", next);
    return next;
  }

  async #pollLoop(signal) {
    let offset = Number(await this.db.get("runtime", OFFSET_KEY, 0)) || 0;
    let failures = 0;

    while (this.running && !signal.aborted) {
      try {
        const updates = await this.client.getUpdates({
          offset: offset || undefined,
          limit: 50,
          timeout: 25,
          allowed_updates: ["message", "my_chat_member", "channel_post", "message_reaction", "message_reaction_count"]
        }, { signal });
        failures = 0;

        for (const update of updates || []) {
          if (!this.running || signal.aborted) break;
          try {
            await this.#processUpdate(update);
          } catch (error) {
            this.#log("error", t("telegram.telegramRuntime.errorProcessingUpdate", { 0: update?.update_id ?? "?" }), error);
            if (error?.retryTelegramUpdate) throw error;
          }
          offset = Number(update.update_id) + 1;
          await this.db.put("runtime", OFFSET_KEY, offset);
          this.events?.emit("telegram:offset", { offset });
        }
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") break;
        failures += 1;
        this.#log("error", t("telegram.telegramRuntime.longPollingError"), error);

        if (error instanceof TelegramApiError && error.isAuthError()) {
          this.running = false;
          this.#setStatus("error", t("telegram.telegramRuntime.invalidOrRevokedToken"), { error });
          break;
        }

        const delay = Math.min(15000, 500 * (2 ** Math.min(failures, 5)));
        const conflict = error instanceof TelegramApiError && error.isConflict();
        this.#setStatus("retrying", conflict
          ? t("telegram.telegramRuntime.getupdatesConflictRetryingInWith", { 0: Math.ceil(delay / 1000) })
          : t("telegram.telegramRuntime.reconnectingInWith", { 0: Math.ceil(delay / 1000) }), { error });
        await sleep(delay, signal).catch(() => {});
        if (this.running && !signal.aborted) this.#setStatus("running", `Long polling: @${this.bot?.username || this.bot?.id || "bot"}`);
      }
    }
  }

  async #processUpdate(update) {
    try {
      await this.publications?.handleUpdate?.(update);
      // System handlers always run before owner/media filtering.
      if (update.my_chat_member) {
        await this.previewChannelBinding.handleMyChatMember(update);
        await this.publicationTargets?.handleMyChatMember?.(update);
        return;
      }
      if (update.channel_post) {
        await this.previewChannelBinding.handleChannelPost(update);
        await this.publicationTargets?.handleMessage?.(update);
        return;
      }

      if (update.message && await this.publicationTargets?.handleMessage?.(update)) return;

      let owner = await this.ownerBinding.getOwner();
      if (!owner) {
        const result = await this.ownerBinding.handleUpdate(update);
        if (result?.bound) owner = result.owner;
        return;
      }

      const message = update.message;
      if (!message) return;
      if (Number(message.from?.id || 0) !== Number(owner.userId)) return;
      if (message.chat?.type !== "private" || Number(message.chat?.id || 0) !== Number(owner.chatId)) return;

      const topicEvent = extractOwnerTopicEvent(message);
      if (topicEvent) await this.events?.emitAsync("telegram:owner-topic-event", topicEvent);

      const media = extractOwnerMedia(message);
      if (!media) return; // text, video_note, stickers and everything else are intentionally ignored.
      const accepted = await this.getMediaSettings();
      if (!accepted[media.type]) return;

      await this.events?.emitAsync("telegram:owner-media", {
        ...media,
        source: {
          chatId: Number(message.chat.id),
          messageId: Number(message.message_id),
          threadId: message.message_thread_id ? Number(message.message_thread_id) : null
        },
        caption: message.caption || "",
        date: message.date || null
      });
    } finally {
      // Service messages are cleaned only after every interested domain has
      // observed the update (for example, forum-topic metadata is retained).
      await this.serviceMessages?.handleUpdate?.(update);
    }
  }

  #setStatus(state, message, extra = {}) {
    this.status = { state, message, at: Date.now(), ...extra };
    this.events?.emit("telegram:runtime-status", this.getStatus());
  }

  #log(level, message, error = null) {
    const entry = {
      id: randomUUID(),
      level,
      message,
      error: error ? { name: error.name, message: error.message, code: error.errorCode || 0 } : null,
      at: Date.now()
    };
    this.events?.emit("telegram:log", entry);
    this.db.put("runtime", "lastLog", entry).catch(() => {});
  }
}

export function extractOwnerTopicEvent(message) {
  const threadId = Number(message?.message_thread_id || 0);
  if (!threadId) return null;
  if (message.forum_topic_created) {
    return {
      action: "created",
      threadId,
      name: message.forum_topic_created.name || `Topic ${threadId}`,
      iconColor: message.forum_topic_created.icon_color || null,
      iconCustomEmojiId: message.forum_topic_created.icon_custom_emoji_id || null,
      chatId: Number(message.chat?.id || 0),
      observedAt: Date.now()
    };
  }
  if (message.forum_topic_edited) {
    return {
      action: "renamed",
      threadId,
      name: message.forum_topic_edited.name || "",
      iconCustomEmojiId: message.forum_topic_edited.icon_custom_emoji_id || null,
      chatId: Number(message.chat?.id || 0),
      observedAt: Date.now()
    };
  }
  return null;
}

export function extractOwnerMedia(message) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const sizes = [...message.photo].sort((a, b) => ((a.width || 0) * (a.height || 0)) - ((b.width || 0) * (b.height || 0)));
    const photo = sizes.at(-1);
    const thumbnail = choosePhotoThumbnail(sizes);
    return {
      type: "photo",
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      thumbnailFileId: thumbnail?.file_id || photo.file_id,
      width: photo.width,
      height: photo.height,
      fileSize: photo.file_size || null,
      telegramObject: photo
    };
  }
  if (message?.video) return mediaFromObject("video", message.video);
  if (message?.audio) return mediaFromObject("audio", message.audio);
  if (message?.voice) return mediaFromObject("voice", message.voice);
  if (message?.document) return mediaFromObject("document", message.document);
  return null;
}

function choosePhotoThumbnail(sizes) {
  if (!sizes?.length) return null;
  const target = 320;
  return [...sizes].sort((a, b) => {
    const aEdge = Math.max(Number(a.width || 0), Number(a.height || 0));
    const bEdge = Math.max(Number(b.width || 0), Number(b.height || 0));
    return Math.abs(aEdge - target) - Math.abs(bEdge - target);
  })[0];
}

function mediaFromObject(type, object) {
  return {
    type,
    fileId: object.file_id,
    fileUniqueId: object.file_unique_id,
    fileName: object.file_name || "",
    mimeType: object.mime_type || "",
    fileSize: object.file_size || null,
    duration: object.duration || null,
    width: object.width || null,
    height: object.height || null,
    thumbnailFileId: object.thumbnail?.file_id || choosePhotoThumbnail(Array.isArray(object.cover) ? object.cover : [])?.file_id || null,
    telegramObject: object
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
