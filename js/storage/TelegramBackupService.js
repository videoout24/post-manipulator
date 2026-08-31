export const MAX_RAW_BACKUP_BYTES = 20 * 1024 * 1024;
const LAST_BACKUP_KEY = "telegramLastBackup";

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

  async findPinnedBackup(owner = null) {
    const target = owner || await this.ownerBinding?.getOwner?.();
    if (!this.client?.hasToken?.() || !target?.chatId) return null;
    const pinned = (await this.client.getChat(target.chatId))?.pinned_message;
    const document = pinned?.document;
    if (!document || !isSupportedBackup(document)) return null;
    return { chatId: target.chatId, messageId: pinned.message_id, document };
  }

  async isDatabaseEmpty() {
    // Identity and owner bindings are bootstrap metadata, not user content;
    // they must not suppress pinned-backup discovery after automatic owner bind.
    return new DatabaseStateInspector({ db: this.db }).isDatabaseEmpty({ includeBindings: false });
  }

  async restoreDownloadedFile(file) {
    if (!(file instanceof Blob)) throw new Error("Выберите скачанный файл резервной копии");
    return this.db.restoreBackup(file);
  }
}

function isSupportedBackup(document) {
  const name = String(document.file_name || "").toLowerCase();
  return /^rich-current-.*\.json$/.test(name) && document.mime_type === "application/json";
}
import { DatabaseStateInspector } from "./DatabaseStateInspector.js?v=1.5.9";
