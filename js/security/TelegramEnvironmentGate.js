import { t } from "../i18n/index.js?v=1.8.0";
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
    if (!webApp) throw new TelegramEnvironmentError("BLOCKED_NOT_TELEGRAM", t("security.telegramEnvironmentGate.openTheApplicationFromTelegramDesktop"));

    if (!Array.isArray(this.config.allowedPlatforms) || !this.config.allowedPlatforms.includes(webApp.platform)) {
      throw new TelegramEnvironmentError("BLOCKED_NOT_DESKTOP", t("security.telegramEnvironmentGate.onlyTheAuthorizedTelegramDesktopClientIs"));
    }
    if (typeof webApp.initData !== "string" || !webApp.initData) {
      throw new TelegramEnvironmentError("BLOCKED_INIT_DATA_MISSING", t("security.telegramEnvironmentGate.telegramDidNotProvideSecureLaunchData"));
    }

    await assertCryptoCapabilities(this.cryptoApi);
    if (typeof webApp.isVersionAtLeast !== "function" || webApp.isVersionAtLeast("6.9") !== true) {
      throw new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_UNSUPPORTED", t("security.telegramEnvironmentGate.updateTelegramDesktopCloudStorageIsRequired"));
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
    throw new TelegramEnvironmentError("BLOCKED_CRYPTO_UNSUPPORTED", t("security.authBootstrapController.thisTelegramClientDoesNotSupportThe"));
  }
  const passwordBytes = cryptoApi.getRandomValues(new Uint8Array(16));
  const aesBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  try {
    await cryptoApi.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    await cryptoApi.subtle.importKey("raw", aesBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch (error) {
    throw new TelegramEnvironmentError("BLOCKED_CRYPTO_UNSUPPORTED", t("security.authBootstrapController.thisTelegramClientDoesNotSupportThe"), { cause: error });
  } finally {
    passwordBytes.fill(0);
    aesBytes.fill(0);
  }
}

function mapStorageError(error) {
  if (error instanceof CloudStorageError) {
    if (error.isUnsupported()) {
      return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_UNSUPPORTED", t("security.telegramEnvironmentGate.telegramDesktopReportedThatCloudStorageIsNot"), { cause: error });
    }
    if (error.code === "TIMEOUT") {
      return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_TIMEOUT", t("security.telegramEnvironmentGate.telegramDesktopDidNotRespondToThe"), { cause: error });
    }
    return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_ERROR", t("security.telegramEnvironmentGate.failedToVerifyCloudStorageDataHasNot", { 0: error.code }), { cause: error });
  }
  return new TelegramEnvironmentError("BLOCKED_CLOUD_STORAGE_ERROR", t("security.telegramEnvironmentGate.failedToVerifyTelegramCloudStorageDataHas"), { cause: error });
}
