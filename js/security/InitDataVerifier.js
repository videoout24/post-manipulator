import { t } from "../i18n/index.js?v=1.8.0";
const TEXT_ENCODER = new TextEncoder();

export const TELEGRAM_PRODUCTION_ED25519_PUBLIC_KEY_HEX =
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";

export class InitDataVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InitDataVerificationError";
    this.code = code;
  }
}

/**
 * Validates the raw Telegram Mini App initData string using Telegram's public
 * Ed25519 key.  The returned object contains only the values the gate needs;
 * it intentionally never retains initData or the full user object.
 */
export async function verifyInitData(initData, {
  launcherBotId,
  publicKeyHex = TELEGRAM_PRODUCTION_ED25519_PUBLIC_KEY_HEX,
  maxAgeSec = 30,
  maxClockSkewSec = 60,
  now = Date.now(),
  cryptoApi = globalThis.crypto
} = {}) {
  const botId = validTelegramId(launcherBotId);
  if (!botId) throw new InitDataVerificationError("CONFIG_INVALID", t("security.initDataVerifier.launcherBotIDIsNotConfigured"));
  if (typeof initData !== "string" || !initData) {
    throw new InitDataVerificationError("INIT_DATA_MISSING", t("security.initDataVerifier.telegramDidNotProvideInitData"));
  }
  if (!cryptoApi?.subtle) {
    throw new InitDataVerificationError("CRYPTO_UNAVAILABLE", t("security.initDataVerifier.webCryptoIsUnavailable"));
  }

  const entries = parseInitData(initData);
  const signature = requiredSingleValue(entries, "signature");
  const authDate = parseAuthDate(requiredSingleValue(entries, "auth_date"));
  const rawUser = requiredSingleValue(entries, "user");
  const dataCheckString = buildDataCheckString(entries, botId);
  const publicKey = hexToBytes(publicKeyHex);
  if (publicKey.byteLength !== 32) {
    throw new InitDataVerificationError("CONFIG_INVALID", t("security.initDataVerifier.incorrectTelegramPublicKey"));
  }

  let key;
  let verified = false;
  try {
    key = await cryptoApi.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    verified = await cryptoApi.subtle.verify(
      { name: "Ed25519" },
      key,
      base64UrlToBytes(signature),
      TEXT_ENCODER.encode(dataCheckString)
    );
  } catch (error) {
    throw new InitDataVerificationError("CRYPTO_UNAVAILABLE", t("security.initDataVerifier.ed25519IsNotAvailableInThisTelegram"));
  }
  if (!verified) throw new InitDataVerificationError("SIGNATURE_INVALID", t("security.initDataVerifier.initdataSignatureVerificationFailed"));

  const currentSec = Math.floor(Number(now) / 1000);
  if (authDate > currentSec + boundedSeconds(maxClockSkewSec, 60)) {
    throw new InitDataVerificationError("AUTH_DATE_FUTURE", t("security.initDataVerifier.miniAppLaunchTimeIsInvalid"));
  }
  if (currentSec - authDate > boundedSeconds(maxAgeSec, 30)) {
    throw new InitDataVerificationError("AUTH_DATE_EXPIRED", t("security.initDataVerifier.miniAppLaunchHasExpired"));
  }

  let user;
  try { user = JSON.parse(rawUser); }
  catch { throw new InitDataVerificationError("TELEGRAM_USER_INVALID", t("security.initDataVerifier.userFieldInInitDataIsCorrupted")); }
  const telegramUserId = validTelegramId(user?.id);
  if (!telegramUserId || user?.is_bot === true) {
    throw new InitDataVerificationError("TELEGRAM_USER_INVALID", t("security.authBootstrapController.telegramDidNotConfirmTheUser"));
  }
  return Object.freeze({ telegramUserId, authDate });
}

export function parseInitData(initData) {
  if (typeof initData !== "string" || !initData) {
    throw new InitDataVerificationError("INIT_DATA_MISSING", t("security.initDataVerifier.telegramDidNotProvideInitData"));
  }
  const entries = [];
  const seen = new Set();
  for (const part of initData.split("&")) {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectInitData"));
    const key = decodeQueryComponent(part.slice(0, separator));
    const value = decodeQueryComponent(part.slice(separator + 1));
    if (!key || seen.has(key)) throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.repeatedInitDataField"));
    seen.add(key);
    entries.push(Object.freeze({ key, value }));
  }
  return Object.freeze(entries);
}

export function buildDataCheckString(entries, launcherBotId) {
  const botId = validTelegramId(launcherBotId);
  if (!botId) throw new InitDataVerificationError("CONFIG_INVALID", t("security.initDataVerifier.launcherBotIDIsNotConfigured"));
  const signed = entries
    .filter(entry => entry.key !== "hash" && entry.key !== "signature")
    .slice()
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  if (!signed.length) throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.noSignableFieldsInInitData"));
  return `${botId}:WebAppData\n${signed.map(entry => `${entry.key}=${entry.value}`).join("\n")}`;
}

function requiredSingleValue(entries, key) {
  const value = entries.find(entry => entry.key === key)?.value;
  if (typeof value !== "string" || !value) {
    throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.isMissingInInitData", { 0: key }));
  }
  return value;
}

function parseAuthDate(value) {
  if (!/^[0-9]{1,16}$/.test(value)) {
    throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectAuthDate"));
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectAuthDate"));
  }
  return number;
}

function decodeQueryComponent(value) {
  try { return decodeURIComponent(String(value).replaceAll("+", " ")); }
  catch { throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectInitDataEncoding")); }
}

function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectInitDataSignature"));
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new InitDataVerificationError("INIT_DATA_INVALID", t("security.initDataVerifier.incorrectInitDataSignature"));
  }
}

function hexToBytes(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/g), pair => Number.parseInt(pair, 16));
}

function validTelegramId(value) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function boundedSeconds(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}
