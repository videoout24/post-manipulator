import { en } from "./en.js?v=1.8.0";
import { ru } from "./ru.js?v=1.8.0";

export const DEFAULT_LANGUAGE = "ru";
export const SUPPORTED_LANGUAGES = Object.freeze(["ru", "en"]);
export const LANGUAGE_PREFERENCE_KEY = "postManipulatorLanguage";

const dictionaries = Object.freeze({ ru, en });
let preference = readPreference();
let locale = resolveLocale(preference);

export function t(key, params = {}) {
  const template = dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LANGUAGE]?.[key] ?? key;
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : match
  ));
}

export function getLocale() {
  return locale;
}

export function getLanguagePreference() {
  return preference;
}

export function setLanguagePreference(nextPreference) {
  const next = nextPreference === "auto" || SUPPORTED_LANGUAGES.includes(nextPreference) ? nextPreference : "auto";
  preference = next;
  locale = resolveLocale(next);
  try { globalThis.localStorage?.setItem?.(LANGUAGE_PREFERENCE_KEY, next); } catch {}
  applyDocumentTranslations(globalThis.document);
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function") {
    globalThis.dispatchEvent(new CustomEvent("app:language-change", { detail: { locale, preference } }));
  }
  return locale;
}

export function languageFromTelegram(languageCode = telegramLanguageCode()) {
  const normalized = String(languageCode || "").trim().toLowerCase().replace("_", "-");
  if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
  return normalized ? "en" : DEFAULT_LANGUAGE;
}

export function applyDocumentTranslations(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const html = root.documentElement || root.querySelector?.("html");
  if (html) html.lang = locale;
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const [attribute, dataName] of [
    ["aria-label", "i18nAriaLabel"],
    ["title", "i18nTitle"],
    ["placeholder", "i18nPlaceholder"],
    ["value", "i18nValue"]
  ]) {
    for (const node of root.querySelectorAll(`[data-${camelToKebab(dataName)}]`)) node.setAttribute(attribute, t(node.dataset[dataName]));
  }
}

function resolveLocale(selected) {
  return selected === "auto" ? languageFromTelegram() : SUPPORTED_LANGUAGES.includes(selected) ? selected : DEFAULT_LANGUAGE;
}

function readPreference() {
  try {
    const stored = globalThis.localStorage?.getItem?.(LANGUAGE_PREFERENCE_KEY);
    return stored === "auto" || SUPPORTED_LANGUAGES.includes(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function telegramLanguageCode() {
  return globalThis.window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
    || globalThis.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
    || globalThis.navigator?.language
    || "";
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}
