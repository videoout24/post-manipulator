const NATIVE_SETTING_KEY = "telegramNativeIntegration";

export class TelegramNavigation {
  constructor({ db, events = null, botIdentity = null, windowRef = globalThis.window, documentRef = globalThis.document } = {}) {
    this.db = db;
    this.events = events;
    this.botIdentity = botIdentity;
    this.windowRef = windowRef;
    this.documentRef = documentRef;
    this.nativeIntegration = true;
    this.bot = null;
    this.unsubscribers = [];

    if (events?.on) {
      this.unsubscribers.push(
        events.on("telegram:native-integration-setting", ({ enabled }) => {
          this.nativeIntegration = Boolean(enabled);
        }),
        events.on("telegram:bot-identity", bot => {
          if (bot?.id) this.bot = structuredClone(bot);
        }),
        events.on("telegram:token-rotated", () => {
          this.#refreshBot().catch(() => {});
        })
      );
    }
  }

  async initialize() {
    if (this.db) this.nativeIntegration = Boolean(await this.db.get("settings", NATIVE_SETTING_KEY, true));
    await this.#refreshBot().catch(() => {});
    return this.snapshot();
  }

  stop() { for (const off of this.unsubscribers.splice(0)) off?.(); }

  snapshot() {
    return {
      nativeIntegration: this.nativeIntegration,
      bot: this.bot ? structuredClone(this.bot) : null
    };
  }

  isNativeIntegrationEnabled() { return this.nativeIntegration; }

  async setNativeIntegration(enabled) {
    this.nativeIntegration = Boolean(enabled);
    if (this.db) await this.db.put("settings", NATIVE_SETTING_KEY, this.nativeIntegration);
    this.events?.emit("telegram:native-integration-setting", { enabled: this.nativeIntegration });
    return this.nativeIntegration;
  }

  openBot(botUsername = this.bot?.username) {
    const links = buildBotLinks(botUsername);
    return this.#open(links);
  }

  openBotStart({ botUsername = this.bot?.username, token = "" } = {}) {
    return this.#open(buildBotStartLinks(botUsername, token));
  }

  openPublicMessage({ username, messageId } = {}) {
    return this.#open(buildPublicMessageLinks(username, messageId));
  }

  openPrivateMessage({ chatId, messageId } = {}) {
    return this.#open(buildPrivateMessageLinks(chatId, messageId));
  }

  openProjectPost(project, postId, deployment = "preview") {
    const post = project?.posts?.find(item => String(item.id) === String(postId));
    const record = post?.deployments?.[deployment];
    if (!record?.chatId || !record?.messageId) return false;
    return this.openPrivateMessage(record);
  }

  #open({ nativeUrl = "", webUrl = "" } = {}) {
    const url = this.nativeIntegration ? (nativeUrl || webUrl) : webUrl;
    if (!url) return false;
    const doc = this.documentRef;
    if (doc?.createElement && doc?.body) {
      const link = doc.createElement("a");
      link.href = url;
      link.rel = "noopener noreferrer";
      // A tg:// navigation in the current browsing context can fire beforeunload,
      // stop the application lifecycle, and then leave the editor tab visible after
      // the native Telegram app opens. Always isolate both native and web links.
      link.target = "_blank";
      link.style.display = "none";
      doc.body.append(link);
      link.click();
      link.remove();
      return true;
    }
    if (this.windowRef?.location) {
      this.windowRef.location.href = url;
      return true;
    }
    return false;
  }

  async #refreshBot() {
    const identity = await this.botIdentity?.getIdentity?.();
    if (identity?.id) this.bot = structuredClone(identity);
    return this.bot;
  }
}

export function buildBotLinks(botUsername) {
  const username = normalizeUsername(botUsername);
  if (!username) return { nativeUrl: "", webUrl: "" };
  return {
    nativeUrl: `tg://resolve?domain=${encodeURIComponent(username)}`,
    webUrl: `https://t.me/${encodeURIComponent(username)}`
  };
}

export function buildBotStartLinks(botUsername, token) {
  const username = normalizeUsername(botUsername);
  const payload = String(token || "").trim();
  if (!username || !payload) return { nativeUrl: "", webUrl: "" };
  return {
    nativeUrl: `tg://resolve?domain=${encodeURIComponent(username)}&start=${encodeURIComponent(payload)}`,
    webUrl: `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(payload)}`
  };
}

export function buildPublicMessageLinks(username, messageId) {
  const domain = normalizeUsername(username);
  const post = normalizeMessageId(messageId);
  if (!domain || !post) return { nativeUrl: "", webUrl: "" };
  return {
    nativeUrl: `tg://resolve?domain=${encodeURIComponent(domain)}&post=${post}`,
    webUrl: `https://t.me/${encodeURIComponent(domain)}/${post}`
  };
}

export function buildPrivateMessageLinks(chatId, messageId) {
  const channel = privateChannelInternalId(chatId);
  const post = normalizeMessageId(messageId);
  if (!channel || !post) return { nativeUrl: "", webUrl: "" };
  return {
    nativeUrl: `tg://privatepost?channel=${channel}&post=${post}`,
    webUrl: `https://t.me/c/${channel}/${post}`
  };
}

export function privateChannelInternalId(chatId) {
  const raw = String(chatId ?? "").trim();
  if (!/^-100\d+$/.test(raw)) return "";
  return raw.slice(4);
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function normalizeMessageId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : 0;
}

export const TELEGRAM_NATIVE_SETTING_KEY = NATIVE_SETTING_KEY;
