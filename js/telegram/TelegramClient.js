import { t } from "../i18n/index.js?v=1.8.0";
import { TelegramRequestScheduler } from "./TelegramRequestScheduler.js?v=1.5.9";

export class TelegramApiError extends Error {
  constructor(message, { method = "", errorCode = 0, description = "", parameters = null, cause = null } = {}) {
    super(message || description || "Telegram API error", cause ? { cause } : undefined);
    this.name = "TelegramApiError";
    this.method = method;
    this.errorCode = errorCode;
    this.description = description || message || "";
    this.parameters = parameters || null;
  }

  isAuthError() { return this.errorCode === 401; }
  isConflict() { return this.errorCode === 409; }
  isNotModified() { return /message is not modified/i.test(this.description); }
  isMessageMissing() {
    return /message to (?:edit|delete) not found|message not found|message can(?:not|'t) be edited|message_id_invalid|message identifier is not specified/i.test(this.description);
  }
  isMessageDeleteForbidden() {
    return /message can(?:not|'t) be deleted|message is too old/i.test(this.description);
  }
  isTopicProblem() {
    return /message thread not found|thread.*not found|topic.*not found|topic.*closed|message_thread_id|topic_id_invalid/i.test(this.description);
  }
}

export class TelegramClient {
  #token = "";

  constructor({ token = "", apiBase = "https://api.telegram.org", scheduler = null, events = null } = {}) {
    this.setToken(token);
    this.apiBase = apiBase.replace(/\/$/, "");
    this.scheduler = scheduler || new TelegramRequestScheduler();
    this.events = events;
  }

  setToken(token) { this.#token = String(token || "").trim(); }
  clearToken() { this.#token = ""; }
  hasToken() { return Boolean(this.#token); }

  async call(method, params = {}, { signal } = {}) {
    if (isScheduledMutation(method)) {
      return this.scheduler.schedule(
        () => this.#callNow(method, params, { signal }),
        {
          chatId: params?.chat_id,
          coalesceKey: telegramCoalesceKey(method, params)
        }
      );
    }
    return this.#callNow(method, params, { signal });
  }

  async #callNow(method, params = {}, { signal } = {}) {
    if (!this.#token) throw new TelegramApiError(t("telegram.botIdentityService.telegramTokenNotSet"), { method, errorCode: 401 });
    const url = `${this.apiBase}/bot${this.#token}/${method}`;
    let response;
    const trackActivity = method !== "getUpdates";
    if (trackActivity) this.events?.emit?.("telegram:request-start", { method });
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripUndefined(params)),
        signal
      });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      if (trackActivity) this.events?.emit?.("telegram:request-network-error", { method, error: cause });
      throw new TelegramApiError(
        t("telegram.telegramClient.failedToContactTelegramBotAPIFor"),
        { method, cause }
      );
    } finally {
      if (trackActivity) this.events?.emit?.("telegram:request-end", { method });
    }
    // Receiving any HTTP response proves that the transport connection is back,
    // even when Telegram subsequently answers with an API error such as 429.
    if (trackActivity) this.events?.emit?.("telegram:request-success", { method });

    let payload = null;
    try { payload = await response.json(); }
    catch (cause) {
      throw new TelegramApiError(t("telegram.telegramClient.telegramReturnedANonJSONResponse", { 0: response.status }), { method, errorCode: response.status, cause });
    }

    if (!response.ok || !payload?.ok) {
      throw new TelegramApiError(payload?.description || `Telegram API ${response.status}`, {
        method,
        errorCode: Number(payload?.error_code || response.status || 0),
        description: payload?.description || "",
        parameters: payload?.parameters || null
      });
    }
    return payload.result;
  }

  getMe(options) { return this.call("getMe", {}, options); }
  getWebhookInfo(options) { return this.call("getWebhookInfo", {}, options); }
  deleteWebhook({ dropPendingUpdates = false } = {}, options) {
    return this.call("deleteWebhook", { drop_pending_updates: dropPendingUpdates }, options);
  }
  getUpdates(params = {}, options) { return this.call("getUpdates", params, options); }
  getFile(fileId, options) { return this.call("getFile", { file_id: fileId }, options); }
  buildFileUrl(filePath) {
    if (!this.#token) throw new TelegramApiError(t("telegram.botIdentityService.telegramTokenNotSet"), { method: "getFileUrl", errorCode: 401 });
    const normalizedPath = String(filePath || "").replace(/^\/+/, "");
    if (!normalizedPath) throw new TelegramApiError(t("telegram.telegramClient.telegramDidNotReturnFilePath"), { method: "getFileUrl" });
    return `${this.apiBase}/file/bot${this.#token}/${normalizedPath}`;
  }

  // Kept as an explicit guard: the Telegram file endpoint is embeddable as an
  // image/media URL, but browser fetch() cannot read its bytes because the file
  // response does not expose CORS headers. Use buildFileUrl() + <img src> in UI.
  async downloadFileBlob() {
    throw new TelegramApiError(
      t("telegram.telegramClient.directFetchOfTelegramFileEndpointIs"),
      { method: "downloadFile" }
    );
  }
  createForumTopic(chatId, name, options) { return this.call("createForumTopic", { chat_id: chatId, name }, options); }
  deleteForumTopic(chatId, messageThreadId, options) {
    return this.call("deleteForumTopic", { chat_id: chatId, message_thread_id: messageThreadId }, options);
  }
  editForumTopic(chatId, messageThreadId, { name, iconCustomEmojiId } = {}, options) {
    return this.call("editForumTopic", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
      name,
      icon_custom_emoji_id: iconCustomEmojiId
    }, options);
  }
  getChatMember(chatId, userId, options) {
    return this.call("getChatMember", { chat_id: chatId, user_id: userId }, options);
  }
  getChat(chatId, options) { return this.call("getChat", { chat_id: chatId }, options); }
  getChatMemberCount(chatId, options) { return this.call("getChatMemberCount", { chat_id: chatId }, options); }
  uploadMedia({ chatId, messageThreadId = null, file, caption = "", type = null } = {}, options = {}) {
    if (!(file instanceof Blob)) throw new TelegramApiError(t("telegram.telegramClient.noFileSelectedForUpload"), { method: "uploadMedia" });
    const media = uploadMediaMethod(file, type);
    return this.scheduler.schedule(
      () => this.#callMultipart(media.method, {
        chat_id: chatId,
        message_thread_id: messageThreadId,
        caption: String(caption || ""),
        [media.field]: file
      }, options),
      { chatId }
    );
  }
  uploadDocument({ chatId, messageThreadId = null, file, caption = "" } = {}, options = {}) {
    if (!(file instanceof Blob)) throw new TelegramApiError(t("telegram.telegramClient.noFileSelectedForUpload"), { method: "sendDocument" });
    return this.scheduler.schedule(
      () => this.#callMultipart("sendDocument", {
        chat_id: chatId,
        message_thread_id: messageThreadId,
        caption: String(caption || ""),
        document: file
      }, options),
      { chatId }
    );
  }
  deleteMessage(chatId, messageId, options) { return this.call("deleteMessage", { chat_id: chatId, message_id: messageId }, options); }
  pinChatMessage(chatId, messageId, { disableNotification = true } = {}, options) {
    return this.call("pinChatMessage", {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: disableNotification
    }, options);
  }
  unpinChatMessage(chatId, messageId, options) {
    return this.call("unpinChatMessage", {
      chat_id: chatId,
      message_id: messageId
    }, options);
  }
  sendRichMessage({ chatId, messageThreadId, richMessage, replyMarkup, disableNotification = true } = {}, options) {
    return this.call("sendRichMessage", {
      chat_id: chatId,
      message_thread_id: messageThreadId,
      rich_message: richMessage,
      reply_markup: replyMarkup,
      disable_notification: disableNotification
    }, options);
  }
  editRichMessage({ chatId, messageId, richMessage, replyMarkup } = {}, options) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      rich_message: richMessage,
      reply_markup: replyMarkup
    }, options);
  }

  async #callMultipart(method, params, { signal } = {}) {
    if (!this.#token) throw new TelegramApiError(t("telegram.botIdentityService.telegramTokenNotSet"), { method, errorCode: 401 });
    const body = new FormData();
    for (const [key, value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === "") continue;
      body.append(key, value instanceof Blob ? value : String(value));
    }
    const url = `${this.apiBase}/bot${this.#token}/${method}`;
    this.events?.emit?.("telegram:request-start", { method });
    let response;
    try {
      response = await fetch(url, { method: "POST", body, signal });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      this.events?.emit?.("telegram:request-network-error", { method, error: cause });
      throw new TelegramApiError(t("telegram.telegramClient.failedToUploadFileToTelegramBot"), { method, cause });
    } finally {
      this.events?.emit?.("telegram:request-end", { method });
    }
    this.events?.emit?.("telegram:request-success", { method });
    let payload;
    try { payload = await response.json(); }
    catch (cause) {
      throw new TelegramApiError(t("telegram.telegramClient.telegramReturnedANonJSONResponse", { 0: response.status }), { method, errorCode: response.status, cause });
    }
    if (!response.ok || !payload?.ok) {
      throw new TelegramApiError(payload?.description || `Telegram API ${response.status}`, {
        method,
        errorCode: Number(payload?.error_code || response.status || 0),
        description: payload?.description || "",
        parameters: payload?.parameters || null
      });
    }
    return payload.result;
  }
}

function uploadMediaMethod(file, explicitType = null) {
  const type = String(explicitType || "").toLowerCase();
  const mime = String(file?.type || "").toLowerCase();
  if (type === "photo" || (!type && mime.startsWith("image/"))) return { type: "photo", method: "sendPhoto", field: "photo" };
  if (type === "video" || (!type && mime.startsWith("video/"))) return { type: "video", method: "sendVideo", field: "video" };
  if (type === "audio" || (!type && mime.startsWith("audio/"))) return { type: "audio", method: "sendAudio", field: "audio" };
  return { type: "document", method: "sendDocument", field: "document" };
}

function isScheduledMutation(method) {
  return new Set([
    "sendRichMessage",
    "editMessageText",
    "deleteMessage",
    "pinChatMessage",
    "unpinChatMessage",
    "createForumTopic",
    "deleteForumTopic",
    "editForumTopic"
  ]).has(method);
}

function telegramCoalesceKey(method, params) {
  if (method !== "editMessageText" || params?.chat_id == null || params?.message_id == null) return "";
  return `${method}:${params.chat_id}:${params.message_id}`;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, stripUndefined(item)]));
}
