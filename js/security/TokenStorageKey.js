import { t } from "../i18n/index.js?v=1.8.0";
export const TOKEN_STORAGE_KEY = "rmb_token_v2";

export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlDecode(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error(t("security.tokenStorageKey.invalidBase64url"));
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  try { return Uint8Array.from(atob(padded), char => char.charCodeAt(0)); }
  catch { throw new Error(t("security.tokenStorageKey.invalidBase64url")); }
}
