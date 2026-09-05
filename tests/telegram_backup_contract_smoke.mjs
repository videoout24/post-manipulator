import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = await readFile(new URL("../js/bootstrap.js", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const backup = await readFile(new URL("../js/storage/TelegramBackupService.js", import.meta.url), "utf8");
const client = await readFile(new URL("../js/telegram/TelegramClient.js", import.meta.url), "utf8");

assert.match(html, /id="createTelegramBackup"/);
assert.match(html, /id="telegramBackupRestoreDialog"/);
assert.match(html, /id="toast"[^>]*><\/div>\s*<\/div>\s*<dialog class="session-token-dialog" id="telegramBackupRestoreDialog"/, "the recovery dialog must stay outside the inert application shell");
assert.match(html, /id="telegramBackupCheckPinned"/);
assert.match(html, /id="telegramBackupRestoreManual"/);
assert.match(app, /inspectPinnedBackup/);
assert.match(app, /searchParams\.set\("restore", "1"\)/);
assert.doesNotMatch(app, /window\.location\.reload/);
assert.match(bootstrap, /recoverBackupBeforeApplication/);
assert.match(bootstrap, /restoreDownloadedFile/);
assert.match(bootstrap, /await recoverBackupBeforeApplication[\s\S]+await import\("\.\/app\.js\?v=1\.7\.18"\)/);
assert.match(backup, /exportBackup\(\)/);
assert.match(backup, /MAX_RAW_BACKUP_BYTES/);
assert.match(backup, /pinChatMessage/);
assert.match(backup, /telegramLastBackup/);
assert.match(backup, /telegramAppliedBackup/);
assert.match(backup, /deleteMessage\(previous\.chatId, previous\.messageId\)\.catch/);
assert.match(backup, /findPinnedBackup/);
assert.match(client, /uploadDocument/);
console.log("telegram_backup_contract_smoke: OK");
