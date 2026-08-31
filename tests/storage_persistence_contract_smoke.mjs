import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const view = fs.readFileSync(new URL("../js/telegram/TelegramSettingsView.js", import.meta.url), "utf8");

assert.match(html, /id="storagePersistenceState"/);
assert.match(html, /id="requestPersistentStorage"/);
assert.match(view, /storageManager\.persisted\(\)/);
assert.match(view, /storageManager\.persist\(\)/);
assert.match(view, /storageManager\.estimate/);
assert.match(view, /#requestPersistentStorage/);

console.log("storage_persistence_contract_smoke: OK");
