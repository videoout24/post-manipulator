import { TelegramApiError } from "../telegram/TelegramClient.js?v=1.5.9";
import { BotIdentityMismatchError, BotIdentityProbeTimeoutError } from "../telegram/BotIdentityService.js?v=1.5.9";
import { DatabaseStateInspector, MINI_APP_USER_IDENTITY_KEY, PUBLISHER_BOT_IDENTITY_KEY } from "../storage/DatabaseStateInspector.js?v=1.5.9";
import { InitDataVerificationError, verifyInitData } from "./InitDataVerifier.js?v=1.7.5";
import { validateNewPassword, validatePassword } from "./PasswordPolicy.js?v=1.5.9";
import { decryptToken, encryptToken } from "./TokenCrypto.js?v=1.7.0";
import { TOKEN_STORAGE_KEY } from "./TokenStorageKey.js?v=1.7.0";

export class AuthBootstrapError extends Error {
  constructor(code, message, { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuthBootstrapError";
    this.code = code;
  }
}

/**
 * Password/token state machine. It owns temporary password references, but
 * never persists them and never returns them to application code.
 */
export class AuthBootstrapController {
  constructor({ db, cloudStorage, initData, initDataPublicKeyHex, maxInitDataAgeSec = 30, maxClockSkewSec = 60, now = () => Date.now(), botIdentityService, inspector = null, cryptoApi = globalThis.crypto } = {}) {
    this.db = db;
    this.cloudStorage = cloudStorage;
    this.initData = String(initData || "");
    this.initDataPublicKeyHex = initDataPublicKeyHex;
    this.maxInitDataAgeSec = maxInitDataAgeSec;
    this.maxClockSkewSec = maxClockSkewSec;
    this.launchValidationTime = Number(now());
    this.telegramUserId = 0;
    this.authDate = 0;
    this.botIdentityService = botIdentityService;
    this.inspector = inspector || new DatabaseStateInspector({ db });
    this.cryptoApi = cryptoApi;
    this.profile = null;
    this.password = "";
    this.state = "BOOT_LOCKED";
    this.busy = false;
    this.userIdentityWritten = false;
  }

  async prepare() {
    let protectedToken;
    try {
      protectedToken = await this.cloudStorage.getItem(TOKEN_STORAGE_KEY);
    }
    catch (error) {
      throw new AuthBootstrapError("CLOUD_STORAGE_READING", "Не удалось найти защищённый token в CloudStorage", { cause: error });
    }

    // Telegram scopes CloudStorage by bot and user. The fixed key therefore
    // reveals no identity, and no database is opened before token verification.
    const hasProtectedToken = Boolean(protectedToken);
    this.profile = Object.freeze({
      kind: hasProtectedToken ? "cloud-locked" : "new",
      hasData: false,
      userId: null,
      botId: null
    });
    this.logStorageProfile();
    return hasProtectedToken
      ? this.transition("UNLOCK_PASSWORD")
      : this.transition("FIRST_SETUP_PASSWORD", { existingData: false });
  }

  beginFirstSetup({ password, confirmation }) {
    return this.exclusive(async () => {
      this.ensureProfile(["new"]);
      this.clearSensitiveState();
      this.password = validateNewPassword(password, confirmation);
      return this.transition("FIRST_SETUP_TOKEN", { existingData: this.profile.hasData });
    });
  }

  async finishFirstSetup({ token }) {
    return this.exclusive(async () => {
      this.ensureProfile(["new"]);
      this.requirePassword();
      return this.persistVerifiedToken({ token, expectedBotId: null, source: "first_setup" });
    });
  }

  async unlock({ password }) {
    return this.exclusive(async () => {
      this.ensureProfile(["cloud-locked"]);
      this.clearSensitiveState();
      this.password = validatePassword(password);
      const storageKey = TOKEN_STORAGE_KEY;
      let record;
      try { record = await this.cloudStorage.getItem(storageKey); }
      catch (error) { throw new AuthBootstrapError("CLOUD_STORAGE_READING", "Не удалось прочитать зашифрованную запись из CloudStorage", { cause: error }); }
      if (!record) return this.transition("RECOVERY_PASSWORD", { reason: "record_not_found" });

      let token;
      try { token = await decryptToken({ container: record, password: this.password, cryptoApi: this.cryptoApi }); }
      catch (error) { return this.transition("RECOVERY_PASSWORD", { reason: "decrypt_failed" }); }
      return this.verifyRotateAndStart({ token, storageKey });
    });
  }

  async beginRecovery({ password, confirmation }) {
    return this.exclusive(async () => {
      if (!["cloud-locked", "bound"].includes(this.profile?.kind)) throw new AuthBootstrapError("INVALID_STATE", "Восстановление сейчас недоступно");
      this.clearSensitiveState();
      this.password = validateNewPassword(password, confirmation);
      return this.transition("RECOVERY_TOKEN", { expectedBotId: this.profile.botId || null });
    });
  }

  async finishRecovery({ token }) {
    return this.exclusive(async () => {
      this.ensureProfile(["cloud-locked", "bound"]);
      this.requirePassword();
      return this.persistVerifiedToken({ token, expectedBotId: this.profile.botId || null, source: "recovery" });
    });
  }

  async replaceRevokedToken({ token }) {
    return this.exclusive(async () => {
      this.ensureProfile(["cloud-locked", "bound"]);
      this.requirePassword();
      return this.persistVerifiedToken({ token, expectedBotId: this.profile.botId || null, source: "token_replacement" });
    });
  }

  clearSensitiveState() { this.password = ""; }

  async verifyRotateAndStart({ token, storageKey }) {
    let verifiedBot;
    try { verifiedBot = await this.inspectToken(token); }
    catch (error) {
      if (error?.code === "TOKEN_REVOKED") return this.transition("TOKEN_REVOKED");
      if (error?.code === "TOKEN_BOT_MISMATCH") return this.transition("TOKEN_BOT_MISMATCH");
      throw error;
    }
    await this.establishVerifiedBotDatabase(verifiedBot.id);
    return this.rotateAndComplete({
      token,
      verifiedBot,
      storageKey,
      bindUser: this.profile.kind !== "bound",
      source: "unlock"
    });
  }

  async persistVerifiedToken({ token, expectedBotId, source }) {
    let verifiedBot;
    try { verifiedBot = await this.inspectToken(token); }
    catch (error) {
      if (error?.code === "TOKEN_REVOKED") return this.transition("TOKEN_INVALID", { flow: source });
      if (error?.code === "TOKEN_BOT_MISMATCH") return this.transition("TOKEN_BOT_MISMATCH");
      if (error?.code === "TOKEN_INVALID") return this.transition("TOKEN_INVALID", { flow: source });
      throw error;
    }
    if (expectedBotId && Number(verifiedBot.id) !== Number(expectedBotId)) {
      this.clearSensitiveState();
      return this.transition("TOKEN_BOT_MISMATCH");
    }
    // Zero setup: getMe is the first trustworthy source of launcher Bot ID.
    // Only after signature verification does the Telegram user ID become trusted.
    await this.establishVerifiedBotDatabase(verifiedBot.id);
    const storageKey = TOKEN_STORAGE_KEY;
    return this.rotateAndComplete({
      token,
      verifiedBot,
      storageKey,
      bindUser: this.profile.kind !== "bound",
      source
    });
  }

  async establishVerifiedBotDatabase(publisherBotId) {
    await this.verifySignedLaunch(publisherBotId);
    this.profile = await this.loadBotDatabaseProfile(publisherBotId);
    if (this.profile.kind === "corrupt") {
      throw new AuthBootstrapError("DATABASE_ERROR", "Привязка IndexedDB выбранного бота повреждена");
    }
    if (this.profile.kind === "user-mismatch") {
      throw new AuthBootstrapError("BLOCKED_TELEGRAM_USER_MISMATCH", "Эта локальная база привязана к другому аккаунту Telegram");
    }
    return this.profile;
  }

  async loadBotDatabaseProfile(publisherBotId) {
    const botId = validId(publisherBotId);
    if (!botId) throw new AuthBootstrapError("DATABASE_ERROR", "Некорректный Bot ID локальной базы");
    let profile;
    try {
      if (typeof this.db?.selectBot === "function") await this.db.selectBot(botId);
      profile = await this.inspector.inspect(this.telegramUserId || null);
    } catch (error) {
      if (error instanceof AuthBootstrapError) throw error;
      throw new AuthBootstrapError("DATABASE_ERROR", "Не удалось открыть IndexedDB выбранного бота", { cause: error });
    }
    if (profile.botId && Number(profile.botId) !== botId) {
      throw new AuthBootstrapError("DATABASE_ERROR", "IndexedDB содержит привязку другого бота");
    }
    return profile;
  }

  logStorageProfile() {
    console.info("[Post Manipulator] Authorization storage profile", {
      kind: this.profile?.kind || "unknown",
      hasData: this.profile?.hasData === true,
      hasLocalUserId: Boolean(this.profile?.userId),
      hasLocalBotId: Boolean(this.profile?.botId)
    });
  }

  async rotateAndComplete({ token, verifiedBot, storageKey, bindUser, source }) {
    this.transition(source === "unlock" ? "TOKEN_ROTATING" : "TOKEN_ENCRYPTING");
    let container = "";
    let previousContainer = null;
    let previousContainerRead = false;
    let containerWritten = false;
    try {
      this.requireTelegramUser();
      previousContainer = await this.cloudStorage.getItem(storageKey);
      previousContainerRead = true;
      container = await encryptToken({ token, password: this.password, cryptoApi: this.cryptoApi });
      await this.cloudStorage.setItem(storageKey, container);
      containerWritten = true;
      const readback = await this.cloudStorage.getItem(storageKey);
      const verifiedToken = await decryptToken({ container: readback, password: this.password, cryptoApi: this.cryptoApi });
      if (verifiedToken !== token) throw new Error("CloudStorage readback mismatch");
      if (bindUser) {
        await this.db.put("bindings", MINI_APP_USER_IDENTITY_KEY, { id: this.telegramUserId });
        const storedUser = await this.db.get("bindings", MINI_APP_USER_IDENTITY_KEY, null);
        if (Number(storedUser?.id) !== Number(this.telegramUserId)) {
          throw new Error("Локальная привязка пользователя не прошла проверку чтением");
        }
        this.userIdentityWritten = true;
      }
      if (!this.profile?.botId) await this.botIdentityService.adoptVerifiedBot(verifiedBot, { source });
      const storedBot = await this.db.get("bindings", PUBLISHER_BOT_IDENTITY_KEY, null);
      if (Number(storedBot?.id) !== Number(verifiedBot.id)) {
        throw new Error("Локальная привязка бота не прошла проверку чтением");
      }
      console.info("[Post Manipulator] Local identity binding saved", {
        userId: this.telegramUserId,
        botId: Number(verifiedBot.id)
      });
      this.profile = Object.freeze({ kind: "bound", hasData: this.profile?.hasData || false, userId: this.telegramUserId, botId: Number(verifiedBot.id) });
      const result = this.transition("STARTING_APPLICATION", {
        token,
        verifiedBot: scrubBot(verifiedBot),
        telegramContext: Object.freeze({ telegramUserId: this.telegramUserId, authDate: this.authDate })
      });
      this.clearSensitiveState();
      return result;
    } catch (error) {
      // The fixed CloudStorage key is updated transactionally from the user's
      // point of view: restore the previous ciphertext if any later step fails.
      if (containerWritten && previousContainerRead) {
        if (previousContainer) await this.cloudStorage.setItem(storageKey, previousContainer).catch(() => {});
        else await this.cloudStorage.removeItem(storageKey).catch(() => {});
      }
      if (!this.profile?.botId && this.userIdentityWritten && typeof this.db.delete === "function") {
        await this.db.delete("bindings", MINI_APP_USER_IDENTITY_KEY).catch(() => {});
        await this.db.delete("bindings", PUBLISHER_BOT_IDENTITY_KEY).catch(() => {});
      }
      this.userIdentityWritten = false;
      throw new AuthBootstrapError("CLOUD_STORAGE_WRITE_ERROR", "Не удалось сохранить зашифрованный token в CloudStorage. Приложение не запущено.", { cause: error });
    } finally {
      container = "";
      previousContainer = null;
    }
  }

  async inspectToken(token) {
    try {
      const bot = await this.botIdentityService.inspectToken(token, { timeoutMs: this.botIdentityService.timeoutMs });
      if (!bot?.id || bot?.is_bot !== true) throw new Error("Telegram getMe не подтвердил бота");
      return scrubBot(bot);
    } catch (error) {
      if (error instanceof BotIdentityMismatchError) throw new AuthBootstrapError("TOKEN_BOT_MISMATCH", "Этот token принадлежит другому боту", { cause: error });
      if (error instanceof TelegramApiError && error.isAuthError()) throw new AuthBootstrapError("TOKEN_REVOKED", "Token отозван или недействителен", { cause: error });
      if (error instanceof BotIdentityProbeTimeoutError) {
        throw new AuthBootstrapError("TOKEN_NETWORK_ERROR", "Telegram не ответил при проверке token. Повторите попытку.", { cause: error });
      }
      if (error instanceof TelegramApiError && !error.errorCode) {
        throw new AuthBootstrapError("TOKEN_NETWORK_ERROR", "Не удалось проверить token: проверьте сеть и повторите попытку", { cause: error });
      }
      throw new AuthBootstrapError("TOKEN_INVALID", "Telegram не принял этот token", { cause: error });
    }
  }

  async verifySignedLaunch(botId) {
    try {
      const verified = await verifyInitData(this.initData, {
        launcherBotId: botId,
        publicKeyHex: this.initDataPublicKeyHex,
        maxAgeSec: this.maxInitDataAgeSec,
        maxClockSkewSec: this.maxClockSkewSec,
        now: this.launchValidationTime,
        cryptoApi: this.cryptoApi
      });
      if (this.profile?.userId && Number(this.profile.userId) !== Number(verified.telegramUserId)) {
        throw new AuthBootstrapError("BLOCKED_TELEGRAM_USER_MISMATCH", "Эта локальная база привязана к другому аккаунту Telegram");
      }
      this.telegramUserId = validId(verified.telegramUserId);
      this.authDate = Number(verified.authDate) || 0;
      this.requireTelegramUser();
      return verified;
    } catch (error) {
      if (error instanceof AuthBootstrapError) throw error;
      throw mapInitDataError(error);
    }
  }

  transition(state, extra = {}) { this.state = state; return Object.freeze({ state, ...extra }); }
  requireTelegramUser() { if (!this.telegramUserId) throw new AuthBootstrapError("TELEGRAM_USER_INVALID", "Telegram не подтвердил пользователя"); }
  requirePassword() { if (!this.password) throw new AuthBootstrapError("PASSWORD_REQUIRED", "Сначала введите пароль"); }
  ensureProfile(kinds) { if (!kinds.includes(this.profile?.kind)) throw new AuthBootstrapError("INVALID_STATE", "Недопустимое состояние авторизации"); }
  async exclusive(operation) {
    if (this.busy) throw new AuthBootstrapError("BUSY", "Операция уже выполняется");
    this.busy = true;
    try { return await operation(); }
    finally { this.busy = false; }
  }
}

function validId(value) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function scrubBot(bot) { return Object.freeze({ id: Number(bot.id), username: String(bot.username || ""), is_bot: true }); }

function mapInitDataError(error) {
  if (!(error instanceof InitDataVerificationError)) {
    return new AuthBootstrapError("BLOCKED_INIT_DATA_INVALID", "Telegram не подтвердил безопасный запуск приложения", { cause: error });
  }
  const code = {
    INIT_DATA_MISSING: "BLOCKED_INIT_DATA_MISSING",
    AUTH_DATE_EXPIRED: "BLOCKED_INIT_DATA_EXPIRED",
    TELEGRAM_USER_INVALID: "BLOCKED_TELEGRAM_USER_INVALID",
    CRYPTO_UNAVAILABLE: "BLOCKED_CRYPTO_UNSUPPORTED"
  }[error.code] || "BLOCKED_INIT_DATA_INVALID";
  const message = code === "BLOCKED_INIT_DATA_EXPIRED"
    ? "Срок безопасного запуска истёк. Закройте и заново откройте Mini App."
    : code === "BLOCKED_CRYPTO_UNSUPPORTED"
      ? "Этот Telegram-клиент не поддерживает нужную криптографию"
      : "Telegram не подтвердил безопасный запуск приложения";
  return new AuthBootstrapError(code, message, { cause: error });
}
