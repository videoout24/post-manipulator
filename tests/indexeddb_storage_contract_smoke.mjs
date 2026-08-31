import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_DATABASE_NAME_PREFIX, databaseNameForBot } from "../js/storage/AppDatabase.js?v=1.7.0";

const adapter = fs.readFileSync(new URL("../js/storage/AppDatabase.js", import.meta.url), "utf8");
const indexedDb = fs.readFileSync(new URL("../js/storage/IndexedDbAppDatabase.js", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../js/bootstrap.js", import.meta.url), "utf8");
const authorization = fs.readFileSync(new URL("../js/security/AuthBootstrapController.js", import.meta.url), "utf8");

assert.equal(APP_DATABASE_NAME_PREFIX, "post-manipulator-bot");
assert.equal(databaseNameForBot(123456), "post-manipulator-bot-123456");
assert.equal(databaseNameForBot("777000"), "post-manipulator-bot-777000");
assert.throws(() => databaseNameForBot(0));
assert.throws(() => databaseNameForBot("not-a-bot"));

assert.match(adapter, /new IndexedDbAppDatabase/);
assert.match(adapter, /async selectBot\(botId\)/);
assert.match(adapter, /Нельзя переключить локальную базу на другого бота/);
assert.doesNotMatch(adapter, /Worker|OPFS|sqlite/i);
assert.match(indexedDb, /Primary persistent storage for one publisher bot/);
assert.match(indexedDb, /rich-current-indexeddb-backup/);
assert.match(indexedDb, /engine: "indexeddb"/);
assert.doesNotMatch(indexedDb, /fallback:\s*"opfs|OPFS fallback/i);
assert.doesNotMatch(indexedDb, /telegramToken|"secrets"/);

assert.match(authorization, /loadBotDatabaseProfile/);
assert.match(authorization, /this\.db\.selectBot\(botId\)/);
assert.doesNotMatch(bootstrap, /await appDb\.open\(\)/);
assert.match(bootstrap, /appDb\.info\.engine !== "indexeddb"/);
assert.match(bootstrap, /Bot database ready/);

console.log("indexeddb_storage_contract_smoke: OK");
