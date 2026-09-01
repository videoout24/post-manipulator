import { t } from "../i18n/index.js?v=1.8.0";
import { base64UrlDecode, base64UrlEncode } from "./TokenStorageKey.js?v=1.7.0";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
export const TOKEN_KDF_ITERATIONS = 600_000;
export const MIN_KDF_ITERATIONS = 100_000;
export const MAX_KDF_ITERATIONS = 2_000_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const MAX_CIPHERTEXT_LENGTH = 16 * 1024;

export class TokenCryptoError extends Error {
  constructor(code, message = t("security.tokenCrypto.failedToDecryptProtectedToken"), { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TokenCryptoError";
    this.code = code;
  }
}

export async function encryptToken({ token, password, iterations = TOKEN_KDF_ITERATIONS, cryptoApi = globalThis.crypto } = {}) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new TokenCryptoError("INPUT_INVALID", t("security.tokenCrypto.failedToEncryptToken"));
  const parameters = validateParameters({ iterations });
  ensureCrypto(cryptoApi);
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_LENGTH));
  let passwordBytes;
  let tokenBytes;
  let key;
  try {
    passwordBytes = TEXT_ENCODER.encode(String(password ?? ""));
    tokenBytes = TEXT_ENCODER.encode(cleanToken);
    key = await deriveAesKey(passwordBytes, salt, parameters.iterations, cryptoApi);
    const ciphertext = new Uint8Array(await cryptoApi.subtle.encrypt({
      name: "AES-GCM", iv, additionalData: aad(), tagLength: 128
    }, key, tokenBytes));
    return JSON.stringify({
      v: 2,
      kdf: { iterations: parameters.iterations, salt: base64UrlEncode(salt) },
      cipher: { iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(ciphertext) }
    });
  } catch (error) {
    if (error instanceof TokenCryptoError) throw error;
    throw new TokenCryptoError("ENCRYPT_FAILED", t("security.tokenCrypto.failedToEncryptToken"), { cause: error });
  } finally {
    passwordBytes?.fill(0);
    tokenBytes?.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

export async function decryptToken({ container, password, cryptoApi = globalThis.crypto } = {}) {
  ensureCrypto(cryptoApi);
  const parsed = parseTokenContainer(container);
  let passwordBytes;
  let plaintext;
  try {
    passwordBytes = TEXT_ENCODER.encode(String(password ?? ""));
    const key = await deriveAesKey(passwordBytes, parsed.salt, parsed.iterations, cryptoApi);
    plaintext = new Uint8Array(await cryptoApi.subtle.decrypt({
      name: "AES-GCM", iv: parsed.iv, additionalData: aad(), tagLength: 128
    }, key, parsed.ciphertext));
    const token = TEXT_DECODER.decode(plaintext);
    if (!token.trim()) throw new TokenCryptoError("TOKEN_DECRYPT_FAILED");
    return token;
  } catch (error) {
    if (error instanceof TokenCryptoError && error.code === "CONTAINER_INVALID") throw error;
    throw new TokenCryptoError("TOKEN_DECRYPT_FAILED");
  } finally {
    passwordBytes?.fill(0);
    plaintext?.fill(0);
    parsed?.salt?.fill(0);
    parsed?.iv?.fill(0);
    parsed?.ciphertext?.fill(0);
  }
}

export function parseTokenContainer(container) {
  if (typeof container !== "string" || container.length > MAX_CIPHERTEXT_LENGTH) {
    throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.protectedRecordIsCorrupted"));
  }
  let parsed;
  try { parsed = JSON.parse(container); }
  catch { throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.protectedRecordIsCorrupted")); }
  if (!hasExactKeys(parsed, ["v", "kdf", "cipher"]) ||
      !hasExactKeys(parsed.kdf, ["iterations", "salt"]) ||
      !hasExactKeys(parsed.cipher, ["iv", "ciphertext"]) ||
      parsed.v !== 2) {
    throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.protectedRecordIsIncompatible"));
  }
  const iterations = Number(parsed.kdf.iterations);
  validateParameters({ iterations });
  let salt; let iv; let ciphertext;
  try {
    salt = base64UrlDecode(parsed.kdf.salt);
    iv = base64UrlDecode(parsed.cipher.iv);
    ciphertext = base64UrlDecode(parsed.cipher.ciphertext);
  } catch { throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.protectedRecordIsCorrupted")); }
  if (salt.byteLength !== SALT_LENGTH || iv.byteLength !== IV_LENGTH || ciphertext.byteLength < 17 || ciphertext.byteLength > MAX_CIPHERTEXT_LENGTH) {
    throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.protectedRecordIsCorrupted"));
  }
  return { iterations, salt, iv, ciphertext };
}

async function deriveAesKey(passwordBytes, salt, iterations, cryptoApi) {
  const material = await cryptoApi.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
  return cryptoApi.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function aad() { return TEXT_ENCODER.encode("rmb:publisher-token:v2"); }
function ensureCrypto(cryptoApi) {
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== "function") throw new TokenCryptoError("CRYPTO_UNAVAILABLE", t("security.initDataVerifier.webCryptoIsUnavailable"));
}
function validateParameters({ iterations }) {
  const count = Number(iterations);
  if (!Number.isSafeInteger(count) || count < MIN_KDF_ITERATIONS || count > MAX_KDF_ITERATIONS) {
    throw new TokenCryptoError("CONTAINER_INVALID", t("security.tokenCrypto.invalidProtectedRecordParameters"));
  }
  return { iterations: count };
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}
