import { t } from "../i18n/index.js?v=1.8.0";
import { TelegramClient } from "./TelegramClient.js?v=1.5.9";

const IDENTITY_STORE = "bindings";
const IDENTITY_KEY = "botIdentity";
export class BotIdentityMismatchError extends Error {
  constructor(expectedId, actualBot) {
    const actualId = Number(actualBot?.id || 0);
    const actualName = actualBot?.username ? `@${actualBot.username}` : String(actualBot?.first_name || t("telegram.botIdentityService.unknownBot"));
    super(t("telegram.botIdentityService.theDatabaseForAnotherBotIsOpen", { 0: expectedId, 1: actualName, 2: actualId }));
    this.name = "BotIdentityMismatchError";
    this.expectedId = Number(expectedId);
    this.actualId = actualId;
    this.actualName = actualName;
  }
}

export class BotIdentityProbeTimeoutError extends Error {
  constructor() {
    super(t("telegram.botIdentityService.telegramDidNotRespondWhenCheckingToken"));
    this.name = "BotIdentityProbeTimeoutError";
  }
}

export class BotIdentityService {
  constructor({ db, client, events = null } = {}) {
    this.db = db;
    this.client = client;
    this.events = events;
  }

  async initialize() {
    const permanent = await this.db.get(IDENTITY_STORE, IDENTITY_KEY, null);
    if (permanent?.id) {
      const identity = { id: Number(permanent.id) };
      if (Object.keys(permanent).length !== 1 || permanent.id !== identity.id) {
        await this.db.put(IDENTITY_STORE, IDENTITY_KEY, identity);
      }
      return identity;
    }
    return null;
  }

  async getIdentity() {
    const permanent = await this.db.get(IDENTITY_STORE, IDENTITY_KEY, null);
    return permanent || await this.initialize();
  }

  async inspectToken(token, { timeoutMs = 15_000, signal = null } = {}) {
    const clean = String(token || "").trim();
    if (!clean) throw new Error(t("telegram.botIdentityService.enterTelegramToken"));
    const probe = new TelegramClient({ token: clean, apiBase: this.client?.apiBase || "https://api.telegram.org" });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    const timeout = globalThis.setTimeout?.(() => controller.abort(), timeoutMs);
    try {
      return await probe.getMe({ signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new BotIdentityProbeTimeoutError();
      throw error;
    } finally {
      globalThis.clearTimeout?.(timeout);
      signal?.removeEventListener?.("abort", abort);
    }
  }

  async assertMatches(bot) {
    const existing = await this.getIdentity();
    if (!existing?.id) return null;
    if (Number(existing.id) !== Number(bot?.id)) {
      throw new BotIdentityMismatchError(existing.id, bot);
    }
    return existing;
  }

  async adoptVerifiedBot(bot, { source = "verified_getMe" } = {}) {
    if (!bot?.id) throw new Error(t("telegram.botIdentityService.telegramGetMeDidNotReturnBotId"));
    const existing = await this.db.get(IDENTITY_STORE, IDENTITY_KEY, null);
    if (existing?.id && Number(existing.id) !== Number(bot.id)) {
      throw new BotIdentityMismatchError(existing.id, bot);
    }
    const identity = { id: Number(bot.id) };
    await this.db.put(IDENTITY_STORE, IDENTITY_KEY, identity);
    this.events?.emit("telegram:bot-identity", {
      ...bot,
      id: Number(bot.id),
      source
    });
    return identity;
  }

  async verifyCurrentClient() {
    if (!this.client?.hasToken()) throw new Error(t("telegram.botIdentityService.telegramTokenNotSet"));
    const bot = await this.client.getMe();
    await this.assertMatches(bot);
    await this.adoptVerifiedBot(bot, { source: "runtime_getMe" });
    return bot;
  }

}
