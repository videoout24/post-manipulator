import { CloudStorageAdapter, CloudStorageError } from "./CloudStorageAdapter.js?v=1.7.0";

export class TelegramEnvironmentError extends Error {
  constructor(code, message, { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TelegramEnvironmentError";
    this.code = code;
  }
}

/** Strict, ordered environment admission for the Mini App bootstrap. */
export class TelegramEnvironmentGate {
  constructor({ config, windowRoot = globalThis.window, cryptoApi = globalThis.crypto } = {}) {
    this.config = config || {};
    this.windowRoot = windowRoot;
    this.cryptoApi = cryptoApi;
  }

  async check() {
    const webApp = this.windowRoot?.Telegram?.WebApp;
    if (!webApp) throw new TelegramEnvironmentError("BLOCKED_NOT_TELEGRAM", "Откройте приложение из Telegram Desktop");

    if (!Array.isArray(this.config.allowedPlatforms) || !this.config.allowedPlatforms.includes(webApp.platform)) {
      throw new TelegramEnvironmentError("BLOCKED_NOT_DESKTOP", "Поддерживается только разрешённый Telegram Desktop-клиент");
    }
    if (typeof webApp.initData !== "string" || !webApp.initData) {
      throw new TelegramEnvironmentError("BLOCKED_INIT_DATA_MISSING", "Telegram не передал данные безопасного запуска");
    }

    await assertCryptoCapabilities(this.cryptoApi);
    if (typeof webApp.isVersionAtLeast !== "function" || webApp.isVersionAtLeast("6.9") !== true) {
      throw new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_UNSUPPORTED", "Обновите Telegram Desktop: требуется CloudStorage");
    }

    let cloudStorage;
    try {
      CloudStorageAdapter.assertShape(webApp.CloudStorage);
      cloudStorage = new CloudStorageAdapter(webApp.CloudStorage, { timeoutMs: this.config.cloudStorageTimeoutMs });
      await cloudStorage.probe();
    } catch (error) {
      throw mapStorageError(error);
    }
    return Object.freeze({
      webApp,
      cloudStorage,
      // The payload stays opaque until getMe has established the Bot ID.
      // That permits a genuine zero setup without a preconfigured bot ID.
      initData: webApp.initData
    });
  }
}

async function assertCryptoCapabilities(cryptoApi) {
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== "function") {
    throw new TelegramEnvironmentError("BLOCKED_CRYPTO_UNSUPPORTED", "Этот Telegram-клиент не поддерживает нужную криптографию");
  }
  const passwordBytes = cryptoApi.getRandomValues(new Uint8Array(16));
  const aesBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  try {
    await cryptoApi.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    await cryptoApi.subtle.importKey("raw", aesBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch (error) {
    throw new TelegramEnvironmentError("BLOCKED_CRYPTO_UNSUPPORTED", "Этот Telegram-клиент не поддерживает нужную криптографию", { cause: error });
  } finally {
    passwordBytes.fill(0);
    aesBytes.fill(0);
  }
}

function mapStorageError(error) {
  if (error instanceof CloudStorageError) {
    if (error.isUnsupported()) {
      return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_UNSUPPORTED", "Telegram Desktop сообщил, что CloudStorage не поддерживается. Обновите клиент.", { cause: error });
    }
    if (error.code === "TIMEOUT") {
      return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_TIMEOUT", "Telegram Desktop не ответил на запрос к CloudStorage. Закройте Mini App и откройте её снова.", { cause: error });
    }
    return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_ERROR", `Не удалось проверить CloudStorage: ${error.code}. Данные не изменены.`, { cause: error });
  }
  return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_ERROR", "Не удалось проверить CloudStorage Telegram. Данные не изменены.", { cause: error });
}
