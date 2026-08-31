import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync(new URL("../js/telegram/TelegramSettingsView.js", import.meta.url), "utf8");
const lifecycle = fs.readFileSync(new URL("../js/app/AppLifecycle.js", import.meta.url), "utf8");
const database = fs.readFileSync(new URL("../js/storage/IndexedDbAppDatabase.js", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../js/security/AuthBootstrapController.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert(!view.includes('db.put("secrets"'));
assert(!view.includes('db.get("secrets"'));
assert.doesNotMatch(view, /inspectToken\(token\)|setToken\(|restoreRememberedToken|SessionTokenStore/);
assert.match(view, /networkPanelStartExpanded/);
assert.match(view, /NETWORK_PANEL_START_EXPANDED_KEY/);
assert(!lifecycle.includes("restoreTelegramPolling"));
assert.doesNotMatch(database, /telegramToken|"secrets"/);
assert.match(authorization, /cloudStorage\.setItem\(storageKey, container\)/);
assert.doesNotMatch(authorization, /db\.put\([^\n]*token/i);
assert.doesNotMatch(html, /id="tgSessionTokenDialog"|tgRememberToken|IndexedDB этого браузера/);
assert.match(html, /Telegram CloudStorage/);
assert.match(html, /id="networkPanelStartExpanded"/);

console.log("telegram_session_token_contract_smoke: cloud credential UI contract OK");
