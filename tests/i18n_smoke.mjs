import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../js/i18n/en.js?v=1.8.0";
import { ru } from "../js/i18n/ru.js?v=1.8.0";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value))
};
globalThis.Telegram = { WebApp: { initDataUnsafe: { user: { language_code: "en-US" } } } };

const i18n = await import(`../js/i18n/index.js?smoke=${Date.now()}`);
assert.equal(i18n.getLanguagePreference(), "auto");
assert.equal(i18n.getLocale(), "en", "automatic mode must follow Telegram language_code");
assert.equal(i18n.languageFromTelegram("ru-RU"), "ru");
assert.equal(i18n.languageFromTelegram("de-DE"), "en", "unsupported Telegram languages fall back to English");

assert.equal(i18n.setLanguagePreference("ru"), "ru");
assert.equal(stored.get(i18n.LANGUAGE_PREFERENCE_KEY), "ru");
assert.equal(i18n.t("html.secureLaunch"), ru["html.secureLaunch"]);
assert.equal(i18n.setLanguagePreference("en"), "en");
assert.equal(i18n.t("html.secureLaunch"), en["html.secureLaunch"]);

const authorTitle = "Название автора не переводится";
assert.equal(
  i18n.t("editor.draftListView.projectPostTitle", { 0: authorTitle }),
  en["editor.draftListView.projectPostTitle"].replace("{0}", authorTitle),
  "translation interpolation must preserve author content verbatim"
);

const ruKeys = Object.keys(ru).sort();
const enKeys = Object.keys(en).sort();
assert.deepEqual(enKeys, ruKeys, "ru and en dictionaries must expose the same keys");
for (const key of ruKeys) {
  assert.deepEqual(placeholders(en[key]), placeholders(ru[key]), `placeholder mismatch for ${key}`);
}

const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
const bootstrap = await readFile(path.join(root, "js/bootstrap.js"), "utf8");
assert.doesNotMatch(indexHtml, /[А-Яа-яЁё]/, "index.html must not contain embedded Russian UI labels");
assert.match(indexHtml, /id="appLanguagePreference"/);
assert.match(indexHtml, /data-i18n="html\.secureLaunch"/);
assert.ok(
  bootstrap.indexOf("applyDocumentTranslations(documentRoot)") < bootstrap.indexOf("new SecurityGateView"),
  "the safe-launch screen must be translated before it is constructed"
);

const jsFiles = await filesUnder(path.join(root, "js"));
const dictionaryKeys = new Set(ruKeys);
for (const file of jsFiles.filter(file => file.endsWith(".js") && !file.endsWith("/i18n/ru.js"))) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /[А-Яа-яЁё]/, `${path.relative(root, file)} contains embedded Russian UI text`);
  assert.doesNotMatch(source, /\b(?:ru-RU|en-US)\b/, `${path.relative(root, file)} contains a fixed display locale`);
  for (const match of source.matchAll(/\bt\("([^"]+)"/g)) {
    assert.ok(dictionaryKeys.has(match[1]), `missing dictionary key ${match[1]} used by ${path.relative(root, file)}`);
  }
}

console.log("i18n_smoke: OK");

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(file));
    else result.push(file);
  }
  return result;
}
