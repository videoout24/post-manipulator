import { DatabaseStateInspector } from "./DatabaseStateInspector.js?v=1.7.1";

export const MAX_RAW_BACKUP_BYTES = 20 * 1024 * 1024;
const LAST_BACKUP_KEY = "telegramLastBackup";
const APPLIED_BACKUP_KEY = "telegramAppliedBackup";
const TELEGRAM_DATE_TOLERANCE_MS = 1000;
const BACKUP_MATCH_TOLERANCE_MS = 30 * 60 * 1000;

export class TelegramBackupService {
  constructor({ db, client, ownerBinding, maxRawBytes = MAX_RAW_BACKUP_BYTES } = {}) {
    this.db = db;
    this.client = client;
    this.ownerBinding = ownerBinding;
    this.maxRawBytes = maxRawBytes;
  }

  async createAndPin() {
    if (!this.client?.hasToken?.()) throw new Error("Введите токен Telegram для текущей сессии");
    const owner = await this.ownerBinding?.getOwner?.();
    if (!owner?.chatId) throw new Error("Сначала привяжите владельца: копия отправляется в его чат с ботом");
    const backup = await this.db.exportBackup();
    if (backup.bytes.byteLength > this.maxRawBytes) throw new Error("Резервная копия больше 20 МБ. Сжатие ZIP пока не добавлено.");

    const file = new File([backup.bytes], backup.filename, { type: backup.mimeType || "application/json" });
    const message = await this.client.uploadDocument({
      chatId: owner.chatId,
      file,
      caption: `Резервная копия Post Manipulator · ${new Date(backup.createdAt).toLocaleString("ru-RU")}`
    });
    await this.client.pinChatMessage(owner.chatId, message.message_id);
    const previous = await this.db.get("runtime", LAST_BACKUP_KEY, null);
    if (previous?.chatId && previous?.messageId) {
      // The previous file may already have been deleted manually. It is no
      // longer relevant after the new backup is pinned, so that is not an error.
      await this.client.deleteMessage(previous.chatId, previous.messageId).catch(() => {});
    }
    const current = { chatId: Number(owner.chatId), messageId: Number(message.message_id), createdAt: backup.createdAt };
    await this.db.put("runtime", LAST_BACKUP_KEY, current);
    return { backup, ...current };
  }

  async findPinnedBackup(owner = null, { signal } = {}) {
    const target = owner || await this.ownerBinding?.getOwner?.();
    if (!this.client?.hasToken?.() || !target?.chatId) return null;
    const pinned = (await this.client.getChat(target.chatId, { signal }))?.pinned_message;
    const document = pinned?.document;
    if (!document || !isSupportedBackup(document)) return null;
    return {
      chatId: Number(target.chatId),
      messageId: Number(pinned.message_id),
      createdAt: telegramMessageDate(pinned.date),
      document
    };
  }

  async inspectPinnedBackup(owner = null, options = {}) {
    const backup = await this.findPinnedBackup(owner, options);
    if (!backup) return Object.freeze({ status: "missing", shouldOfferRestore: false, backup: null });

    const inspector = new DatabaseStateInspector({ db: this.db });
    const [local, lastCreated, lastApplied] = await Promise.all([
      inspector.inspectMeaningfulData({ includeBindings: false }),
      this.db.get("runtime", LAST_BACKUP_KEY, null),
      this.db.get("runtime", APPLIED_BACKUP_KEY, null)
    ]);
    const alreadyCurrent = matchesBackup(lastCreated, backup) || matchesAppliedBackup(lastApplied, backup);
    const newerByDate = backup.createdAt > 0 &&
      backup.createdAt > local.latestUpdatedAt + TELEGRAM_DATE_TOLERANCE_MS;
    const localNewerByDate = local.hasData && backup.createdAt > 0 &&
      local.latestUpdatedAt > backup.createdAt + TELEGRAM_DATE_TOLERANCE_MS;
    const shouldOfferRestore = !alreadyCurrent && (!local.hasData || newerByDate);
    const status = alreadyCurrent
      ? localNewerByDate ? "not-newer" : "current"
      : shouldOfferRestore
        ? "newer"
        : backup.createdAt > 0
          ? "not-newer"
          : "unknown-date";

    return Object.freeze({
      status,
      shouldOfferRestore,
      backup,
      localHasData: local.hasData,
      localUpdatedAt: local.latestUpdatedAt
    });
  }

  async isDatabaseEmpty() {
    // Identity and owner bindings are bootstrap metadata, not user content;
    // they must not suppress pinned-backup discovery after automatic owner bind.
    return new DatabaseStateInspector({ db: this.db }).isDatabaseEmpty({ includeBindings: false });
  }

  async restoreDownloadedFile(file, { sourceBackup = null } = {}) {
    if (!(file instanceof Blob)) throw new Error("Выберите скачанный файл резервной копии");
    const result = await this.db.restoreBackup(file);
    const restored = {
      backupCreatedAt: Number(result?.restoredBackupCreatedAt || 0),
      fileName: normalizeBackupFileName(file.name),
      appliedAt: Date.now()
    };
    const matchedPinnedBackup = selectedFileMatchesBackup(restored, sourceBackup);
    if (matchedPinnedBackup) {
      Object.assign(restored, {
        chatId: Number(sourceBackup.chatId),
        messageId: Number(sourceBackup.messageId),
        createdAt: Number(sourceBackup.createdAt || restored.backupCreatedAt || Date.now())
      });
    }
    await this.db.put("runtime", APPLIED_BACKUP_KEY, restored);
    if (matchedPinnedBackup) await this.db.put("runtime", LAST_BACKUP_KEY, restored);
    return Object.freeze({ ...result, matchedPinnedBackup });
  }
}

function isSupportedBackup(document) {
  const name = String(document.file_name || "").toLowerCase();
  return /^rich-current-.*\.json$/.test(name) && document.mime_type === "application/json";
}

function telegramMessageDate(value) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function matchesBackup(record, backup) {
  return Number(record?.chatId) === Number(backup?.chatId) &&
    Number(record?.messageId) === Number(backup?.messageId);
}

function matchesAppliedBackup(record, backup) {
  if (matchesBackup(record, backup)) return true;
  const recordName = normalizeBackupFileName(record?.fileName);
  const backupName = normalizeBackupFileName(backup?.document?.file_name);
  if (recordName && backupName) return recordName === backupName;
  return datesMatch(record?.backupCreatedAt, backup?.createdAt);
}

function selectedFileMatchesBackup(restored, backup) {
  if (!backup?.chatId || !backup?.messageId) return false;
  const selectedName = normalizeBackupFileName(restored?.fileName);
  const pinnedName = normalizeBackupFileName(backup?.document?.file_name);
  if (selectedName && pinnedName) return selectedName === pinnedName;
  return datesMatch(restored?.backupCreatedAt, backup?.createdAt);
}

function normalizeBackupFileName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s*\(\d+\)(?=\.json$)/, "");
}

function datesMatch(left, right) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  return Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0 &&
    Math.abs(a - b) <= BACKUP_MATCH_TOLERANCE_MS;
}
