import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const view = await readFile(new URL("../js/telegram/TelegramSettingsView.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
await assert.rejects(access(new URL("../js/telegram/SessionTokenStore.js", import.meta.url)));
assert.doesNotMatch(view, /SessionTokenStore|restoreRememberedToken|persistToken|setToken\(/);
assert.doesNotMatch(html, /tgRememberToken|tgSessionToken|tgTokenForm/);
console.log("session_token_store_contract_smoke: legacy IndexedDB token flow removed");
