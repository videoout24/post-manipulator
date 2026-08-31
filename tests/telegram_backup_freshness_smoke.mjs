import assert from "node:assert/strict";
import { TelegramBackupService } from "../js/storage/TelegramBackupService.js?v=1.7.1";

const contentRows = new Map();
const runtime = new Map();
const writes = [];
const db = {
  async all(store) {
    if (store === "bindings") return [];
    return contentRows.get(store) || [];
  },
  async get(store, key, fallback = null) {
    return store === "runtime" && runtime.has(key) ? runtime.get(key) : fallback;
  },
  async put(store, key, value) {
    writes.push({ store, key, value });
    if (store === "runtime") runtime.set(key, value);
    return value;
  },
  async restoreBackup() {
    return { restoredBackupCreatedAt: 1_900_000, restoredRecordCount: 4 };
  }
};
let pinnedMessage = backupMessage({ messageId: 17, sentAtSeconds: 2_000 });
const client = {
  hasToken: () => true,
  getChat: async () => ({ pinned_message: pinnedMessage })
};
const owner = { chatId: 42 };
const service = new TelegramBackupService({ db, client, ownerBinding: { getOwner: async () => owner } });

contentRows.set("projects", [{ key: "project", value: {}, updatedAt: 1_000_000 }]);
let inspection = await service.inspectPinnedBackup();
assert.equal(inspection.status, "newer");
assert.equal(inspection.shouldOfferRestore, true);
assert.equal(inspection.backup.createdAt, 2_000_000, "Telegram server date must drive backup freshness");

contentRows.set("projects", [{ key: "project", value: {}, updatedAt: 3_000_000 }]);
inspection = await service.inspectPinnedBackup();
assert.equal(inspection.status, "not-newer");
assert.equal(inspection.shouldOfferRestore, false);

contentRows.clear();
inspection = await service.inspectPinnedBackup();
assert.equal(inspection.status, "newer", "an empty local database must offer the latest pinned backup");

runtime.set("telegramAppliedBackup", { chatId: 42, messageId: 17, createdAt: 2_000_000 });
inspection = await service.inspectPinnedBackup();
assert.equal(inspection.status, "current");
assert.equal(inspection.shouldOfferRestore, false, "an already restored pinned backup must not be offered again");

runtime.clear();
const sourceBackup = inspection.backup;
await service.restoreDownloadedFile(new Blob(["backup"]), { sourceBackup });
assert.deepEqual(
  writes.filter(write => write.store === "runtime").map(write => write.key).sort(),
  ["telegramAppliedBackup", "telegramLastBackup"],
  "restoration must remember the exact pinned backup"
);

pinnedMessage = {
  message_id: 18,
  date: 3_000,
  text: "newest pinned message is not a backup"
};
inspection = await service.inspectPinnedBackup();
assert.equal(inspection.status, "missing");
assert.equal(inspection.backup, null);

console.log("telegram_backup_freshness_smoke: OK");

function backupMessage({ messageId, sentAtSeconds }) {
  return {
    message_id: messageId,
    date: sentAtSeconds,
    document: {
      file_name: `rich-current-${messageId}.json`,
      mime_type: "application/json"
    }
  };
}
