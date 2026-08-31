import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const backup = await readFile(new URL("../js/storage/TelegramBackupService.js", import.meta.url), "utf8");
const client = await readFile(new URL("../js/telegram/TelegramClient.js", import.meta.url), "utf8");

assert.match(html, /id="createTelegramBackup"/);
assert.match(html, /id="telegramBackupRestoreDialog"/);
assert.match(html, /id="telegramBackupCheckPinned"/);
assert.match(html, /id="telegramBackupRestoreManual"/);
assert.match(app, /inspectPinnedBackup/);
assert.match(app, /restoreDownloadedFile/);
assert.match(backup, /exportBackup\(\)/);
assert.match(backup, /MAX_RAW_BACKUP_BYTES/);
assert.match(backup, /pinChatMessage/);
assert.match(backup, /telegramLastBackup/);
assert.match(backup, /telegramAppliedBackup/);
assert.match(backup, /deleteMessage\(previous\.chatId, previous\.messageId\)\.catch/);
assert.match(backup, /findPinnedBackup/);
assert.match(client, /uploadDocument/);
console.log("telegram_backup_contract_smoke: OK");
