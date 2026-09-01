import { t } from "../i18n/index.js?v=1.8.0";
const CLOUD_STORAGE_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_CLOUD_STORAGE_VALUE_LENGTH = 4096;

export class CloudStorageError extends Error {
  constructor(code, message = t("security.cloudStorageAdapter.telegramCloudStorageIsUnavailable"), { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CloudStorageError";
    this.code = code;
  }

  isUnsupported() { return this.code === "UNSUPPORTED"; }
}

/** Promise wrapper around the Telegram callback-only CloudStorage bridge. */
export class CloudStorageAdapter {
  constructor(storage, { timeoutMs = 12_000, timer = globalThis } = {}) {
    this.storage = storage;
    this.timeoutMs = timeoutMs;
    this.timer = timer;
  }

  static assertShape(storage) {
    // Authorization uses one fixed record. Listing all records is neither
    // necessary nor part of the minimum bridge contract for this flow.
    for (const name of ["getItem", "setItem", "removeItem"]) {
      if (typeof storage?.[name] !== "function") {
        throw new CloudStorageError("UNSUPPORTED", t("security.cloudStorageAdapter.telegramCloudStorageIsNotSupportedByThis"));
      }
    }
    return storage;
  }

  async probe(key = "rmb_cloud_probe_v1") {
    await this.getItem(key);
    return true;
  }

  async getItem(key) {
    assertKey(key);
    const [value] = await this.#invoke("getItem", [key]);
    return value == null ? null : String(value);
  }

  async setItem(key, value) {
    assertKey(key);
    const stringValue = String(value);
    if (stringValue.length > MAX_CLOUD_STORAGE_VALUE_LENGTH) {
      throw new CloudStorageError("VALUE_TOO_LARGE", t("security.cloudStorageAdapter.encryptedEntryExceedsTheTelegramCloudStorageLimit"));
    }
    const [stored] = await this.#invoke("setItem", [key, stringValue]);
    if (stored !== true) throw new CloudStorageError("WRITE_FAILED", t("security.cloudStorageAdapter.telegramDidNotConfirmTheCloudStorage"));
    return true;
  }

  async removeItem(key) {
    assertKey(key);
    const [removed] = await this.#invoke("removeItem", [key]);
    if (removed !== true) throw new CloudStorageError("REMOVE_FAILED", t("security.cloudStorageAdapter.telegramDidNotConfirmTheDeletionOf"));
    return true;
  }

  async getKeys() {
    const [keys] = await this.#invoke("getKeys", []);
    if (!Array.isArray(keys)) throw new CloudStorageError("READ_FAILED", t("security.cloudStorageAdapter.telegramReturnedAnIncorrectCloudStorageKeyList"));
    return keys.map(key => String(key));
  }

  #invoke(method, args) {
    if (typeof this.storage?.[method] !== "function") {
      return Promise.reject(new CloudStorageError("UNSUPPORTED", t("security.cloudStorageAdapter.telegramCloudStorageIsNotSupportedByThis")));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        this.timer.clearTimeout?.(timeout);
        callback(value);
      };
      const timeout = this.timer.setTimeout?.(() => finish(reject)(
        new CloudStorageError("TIMEOUT", t("security.cloudStorageAdapter.telegramCloudStorageDidNotRespondInTime"))
      ), this.timeoutMs);
      const callback = (error, ...result) => {
        if (error) {
          finish(reject)(normalizeTelegramStorageError(error));
          return;
        }
        finish(resolve)(result);
      };
      try { this.storage[method](...args, callback); }
      catch (error) { finish(reject)(normalizeTelegramStorageError(error)); }
    });
  }
}

function assertKey(key) {
  if (typeof key !== "string" || !CLOUD_STORAGE_KEY.test(key)) {
    throw new CloudStorageError("KEY_INVALID", t("security.cloudStorageAdapter.invalidTelegramCloudStorageKey"));
  }
}

function normalizeTelegramStorageError(error) {
  if (error instanceof CloudStorageError) return error;
  const raw = typeof error === "string" ? error : error?.error || error?.message || String(error || "");
  const code = /UNSUPPORTED/i.test(raw) ? "UNSUPPORTED" : /CANCEL/i.test(raw) ? "CANCELLED" : "BRIDGE_ERROR";
  return new CloudStorageError(code, code === "UNSUPPORTED"
    ? t("security.cloudStorageAdapter.telegramCloudStorageIsNotSupportedByThis")
    : t("security.cloudStorageAdapter.telegramCloudStorageError"), { cause: error });
}
