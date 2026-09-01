import { t } from "../i18n/index.js?v=1.8.0";
import { TelegramApiError } from "./TelegramClient.js?v=1.5.9";

const LIVE_PREVIEW_KEY = "livePreviewEnabled";
const LIVE_MESSAGE_KEY = "liveMessage";

export class PreviewController {
  constructor({ db, events, client, previewChannelBinding, renderer, validator, tree, treeProvider = null, syncGuard = null, debounceMs = 850 }) {
    this.db = db;
    this.events = events;
    this.client = client;
    this.previewChannelBinding = previewChannelBinding;
    this.renderer = renderer;
    this.validator = validator;
    this.tree = tree;
    this.treeProvider = treeProvider;
    this.syncGuard = syncGuard;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.syncPromise = null;
    this.resyncRequested = false;
    this.resyncForce = false;
  }

  async isEnabled() {
    const [enabled, channel] = await Promise.all([
      this.db.get("settings", LIVE_PREVIEW_KEY, false),
      this.previewChannelBinding.getSlot()
    ]);
    return Boolean(enabled && channel?.status === "bound");
  }

  getMessage() { return this.db.get("preview", LIVE_MESSAGE_KEY, null); }
  getChannel() { return this.previewChannelBinding.getSlot(); }

  async setEnabled(enabled) {
    if (enabled) {
      const channel = await this.previewChannelBinding.getSlot();
      if (channel?.status !== "bound") throw new Error(t("telegram.previewController.bindAPrivatePreviewChannelFirst"));
    }
    await this.db.put("settings", LIVE_PREVIEW_KEY, Boolean(enabled));
    this.events?.emit("telegram:live-preview-setting", { enabled: Boolean(enabled) });
    if (enabled) this.schedule({ immediate: true });
  }

  schedule({ immediate = false } = {}) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.#isSyncAllowed()) return false;
    if (immediate) {
      this.timer = setTimeout(() => this.sync().catch(error => this.#emitError(error)), 0);
      return true;
    }
    this.timer = setTimeout(() => this.sync().catch(error => this.#emitError(error)), this.debounceMs);
    return true;
  }

  async sync({ force = false } = {}) {
    // If edits arrive while Telegram is still processing the previous preview,
    // never drop the newest editor state. Queue one coalesced follow-up sync.
    if (this.syncPromise) {
      this.resyncRequested = true;
      this.resyncForce ||= Boolean(force);
      return this.syncPromise;
    }

    this.syncPromise = (async () => {
      let result = null;
      let nextForce = Boolean(force);
      do {
        this.resyncRequested = false;
        const runForce = nextForce || this.resyncForce;
        this.resyncForce = false;
        nextForce = false;
        result = await this.#sync({ force: runForce });
      } while (this.resyncRequested);
      return result;
    })().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async #sync({ force }) {
    if (!this.#isSyncAllowed()) return { skipped: "guarded" };
    if (!force && !(await this.isEnabled())) return { skipped: "disabled" };
    if (!this.#isSyncAllowed()) return { skipped: "guarded" };
    if (!this.client.hasToken()) return { skipped: "no_token" };
    const channel = await this.previewChannelBinding.getSlot();
    if (!this.#isSyncAllowed()) return { skipped: "guarded" };
    if (channel?.status !== "bound") {
      const status = { state: "unavailable", message: t("telegram.previewController.thePrivatePreviewChannelIsNotBound") };
      this.events?.emit("telegram:preview-status", status);
      return { skipped: "channel_not_bound" };
    }

    // The shared Editor tree may switch to a Project while an older standalone
    // preview timer is awaiting IndexedDB or Telegram. Check the context directly
    // before reading the tree so Project-only blocks can never reach this message.
    const renderTree = this.treeProvider?.() || this.tree;
    const errors = this.validator.validate(renderTree);
    if (errors.length) {
      // Editing is allowed to pass through temporarily incomplete states. Never send
      // a knowingly invalid Rich Message to Telegram; just wait for the next edit.
      this.events?.emit("telegram:preview-status", {
        state: "waiting",
        message: t("telegram.previewController.thePreviewIsWaitingToBeFilled", { 0: errors.length, 1: errors.length === 1 ? t("editor.editorPreviewStatusView.error") : t("telegram.previewController.errors") }),
        errors
      });
      return { skipped: "invalid", errors };
    }

    const envelope = this.renderer.renderEnvelope ? this.renderer.renderEnvelope(renderTree) : { richMessage: this.renderer.render(renderTree), replyMarkup: undefined };
    const { richMessage, replyMarkup } = envelope;
    const hash = stableHash(envelope);
    const previous = await this.db.get("preview", LIVE_MESSAGE_KEY, null);
    if (!this.#isSyncAllowed()) return { skipped: "guarded" };
    if (!force && previous?.hash === hash && Number(previous.chatId) === Number(channel.chatId)) return { skipped: "unchanged", previous };

    this.events?.emit("telegram:preview-status", { state: "syncing", message: t("telegram.previewController.updatingPreview") });
    if (previous?.messageId && Number(previous.chatId) === Number(channel.chatId)) {
      if (!this.#isSyncAllowed()) return { skipped: "guarded" };
      try {
        const edited = await this.client.editRichMessage({
          chatId: channel.chatId,
          messageId: previous.messageId,
          richMessage,
          replyMarkup
        });
        const state = await this.#saveMessage({ message: edited, channel, hash, mode: "edited" });
        this.events?.emit("telegram:preview-status", { state: "synced", message: t("telegram.previewController.previewSynchronized"), preview: state });
        return state;
      } catch (error) {
        if (error instanceof TelegramApiError && error.isNotModified()) {
          const state = { ...previous, hash, syncedAt: Date.now() };
          await this.db.put("preview", LIVE_MESSAGE_KEY, state);
          this.events?.emit("telegram:preview-status", { state: "synced", message: t("telegram.previewController.previewSynchronized"), preview: state });
          return state;
        }
        if (!(error instanceof TelegramApiError && error.isMessageMissing())) {
          await this.#handleChannelError(error);
          throw error;
        }
        // A removed live-preview message is recreated in the same channel.
      }
    }

    if (!this.#isSyncAllowed()) return { skipped: "guarded" };
    const sent = await this.#sendAndPin({ channel, richMessage, replyMarkup });
    const state = await this.#saveMessage({
      message: sent,
      channel,
      hash,
      mode: previous?.messageId ? "recreated" : "created",
      pinned: true
    });
    this.events?.emit("telegram:preview-status", {
      state: "synced",
      message: previous?.messageId
        ? t("telegram.previewController.previewServiceMessageRestoredAndPinned")
        : t("telegram.previewController.previewServiceMessageCreatedAndPinned"),
      preview: state
    });
    return state;
  }

  async #sendAndPin({ channel, richMessage, replyMarkup }) {
    let message;
    try {
      message = await this.client.sendRichMessage({
        chatId: channel.chatId,
        richMessage,
        replyMarkup,
        disableNotification: true
      });
      await this.client.pinChatMessage(channel.chatId, Number(message.message_id), { disableNotification: true });
      return message;
    } catch (error) {
      if (message?.message_id) {
        await this.client.deleteMessage(channel.chatId, Number(message.message_id)).catch(() => {});
      }
      await this.#handleChannelError(error);
      throw error;
    }
  }

  async #saveMessage({ message, channel, hash, mode, pinned = null }) {
    const previous = await this.getMessage();
    const state = {
      chatId: Number(channel.chatId),
      messageId: Number(message.message_id),
      hash,
      mode,
      pinned: pinned == null ? Boolean(previous?.pinned) : Boolean(pinned),
      syncedAt: Date.now()
    };
    await this.db.put("preview", LIVE_MESSAGE_KEY, state);
    return state;
  }

  async #handleChannelError(error) {
    if (!(error instanceof TelegramApiError)) return;
    if (error.errorCode === 403 || /not enough rights|chat not found|bot was kicked|bot is not a member/i.test(error.description || "")) {
      await this.previewChannelBinding.markUnavailable(`telegram_${error.errorCode || "error"}`, error).catch(() => {});
    }
  }

  #isSyncAllowed() {
    if (typeof this.syncGuard !== "function") return true;
    try { return this.syncGuard() !== false; }
    catch { return false; }
  }

  #emitError(error) {
    const method = error?.method ? `${error.method}: ` : "";
    const description = error?.description || error?.message || String(error);
    this.events?.emit("telegram:preview-status", {
      state: "error",
      message: `${method}${description}`,
      error
    });
  }
}

function stableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
