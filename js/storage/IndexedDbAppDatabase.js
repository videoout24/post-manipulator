const DATABASE_VERSION = 1;
const RECORDS_STORE = "records";
const BY_STORE_INDEX = "by_store";
const BACKUP_FORMAT = "rich-current-indexeddb-backup";
const BACKUP_VERSION = 1;

export const APP_DATABASE_STORES = Object.freeze([
  "settings", "bindings", "runtime", "topics", "preview",
  "gallery", "thumbnail_cache", "projects", "messages", "drafts", "publications", "link_relations"
]);

const VALID_STORES = new Set(APP_DATABASE_STORES);

/**
 * Primary persistent storage for one publisher bot. It keeps the AppDatabase
 * key/value API intact and never stores credentials: the encrypted token
 * belongs only in Telegram CloudStorage.
 */
export class IndexedDbAppDatabase {
  constructor({ indexedDb = globalThis.indexedDB, databaseName } = {}) {
    this.indexedDb = indexedDb;
    this.databaseName = String(databaseName || "");
    this.database = null;
    this.openPromise = null;
    this.info = null;
  }

  open() {
    if (this.openPromise) return this.openPromise;
    if (!this.databaseName) {
      return Promise.reject(new Error("Не задано имя IndexedDB для выбранного бота"));
    }
    if (!this.indexedDb?.open) {
      return Promise.reject(new Error("Telegram Desktop не поддерживает IndexedDB, необходимый для локальных данных"));
    }
    this.openPromise = new Promise((resolve, reject) => {
      let request;
      try { request = this.indexedDb.open(this.databaseName, DATABASE_VERSION); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORDS_STORE)) {
          const records = database.createObjectStore(RECORDS_STORE, { keyPath: ["store", "key"] });
          records.createIndex(BY_STORE_INDEX, "store", { unique: false });
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => this.database?.close();
        this.info = Object.freeze({
          engine: "indexeddb",
          databaseName: this.databaseName,
          schemaVersion: BACKUP_VERSION,
          filename: `${this.databaseName}.json`,
          persistent: true
        });
        resolve(this.info);
      };
      request.onerror = () => reject(request.error || new Error("Не удалось открыть IndexedDB"));
      request.onblocked = () => reject(new Error("Закройте другие окна Post Manipulator и откройте Mini App заново"));
    }).catch(error => {
      this.openPromise = null;
      throw error;
    });
    return this.openPromise;
  }

  async get(store, key, fallback = null) {
    validateStore(store);
    const record = await this.#withStore("readonly", records => requestResult(records.get([store, String(key)])));
    return record ? record.value : fallback;
  }

  async put(store, key, value, updatedAt = Date.now()) {
    validateStore(store);
    const record = { store, key: String(key), value, updatedAt: Number(updatedAt || Date.now()) };
    await this.#withStore("readwrite", records => requestResult(records.put(record)));
    return value;
  }

  async delete(store, key) {
    validateStore(store);
    await this.#withStore("readwrite", records => requestResult(records.delete([store, String(key)])));
    return true;
  }

  async clear(store) {
    validateStore(store);
    await this.#withStore("readwrite", async records => {
      const keys = await requestResult(records.index(BY_STORE_INDEX).getAllKeys(store));
      await Promise.all(keys.map(key => requestResult(records.delete(key))));
    });
    return true;
  }

  async all(store) {
    validateStore(store);
    const rows = await this.#withStore("readonly", records => requestResult(records.index(BY_STORE_INDEX).getAll(store)));
    return rows.map(toPublicRow);
  }

  async indexAll(store, indexName, query = null) {
    const rows = await this.all(store);
    return rows.filter(row => indexValue(store, row.value, indexName) === (query == null ? null : query));
  }

  async exportBackup() {
    const records = await this.#allRecords();
    const createdAt = Date.now();
    const bytes = new TextEncoder().encode(JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      records
    }, backupReplacer));
    return {
      bytes,
      filename: `rich-current-${new Date(createdAt).toISOString().replaceAll(":", "-")}.json`,
      mimeType: "application/json",
      createdAt,
      schemaVersion: BACKUP_VERSION,
      storageEngine: "indexeddb"
    };
  }

  async restoreBackup(input) {
    const parsed = parseBackup(input);
    await this.#withStore("readwrite", async records => {
      await requestResult(records.clear());
      await Promise.all(parsed.records.map(record => requestResult(records.put(record))));
    });
    return Object.freeze({
      ...this.info,
      restoredBackupCreatedAt: parsed.createdAt,
      restoredRecordCount: parsed.records.length
    });
  }

  async close() {
    this.database?.close();
    this.database = null;
    this.openPromise = null;
    this.info = null;
  }

  async #allRecords() {
    const rows = await this.#withStore("readonly", records => requestResult(records.getAll()));
    return rows.map(record => ({ store: record.store, key: record.key, value: record.value, updatedAt: Number(record.updatedAt || 0) }));
  }

  async #withStore(mode, operation) {
    await this.open();
    const transaction = this.database.transaction(RECORDS_STORE, mode);
    const done = transactionDone(transaction);
    try {
      const result = await operation(transaction.objectStore(RECORDS_STORE));
      await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction has already completed */ }
      await done.catch(() => {});
      throw error;
    }
  }
}

function validateStore(store) {
  if (!VALID_STORES.has(store)) throw new Error(`Неизвестное хранилище IndexedDB: ${store}`);
}

function indexValue(store, value, indexName) {
  const object = value && typeof value === "object" ? value : {};
  switch (indexName) {
    case "byType": return store === "gallery" ? nullableText(object.type) : null;
    case "byThreadId": return store === "gallery" ? nullableNumber(object.topicThreadId) : null;
    case "byFileUniqueId": return store === "gallery" ? nullableText(object.telegram?.fileUniqueId) : null;
    case "byCreatedAt": return store === "gallery" ? nullableNumber(object.createdAt) : null;
    case "bySourceEventKey": return store === "gallery" ? nullableText(object.sourceEventKey) : null;
    case "byLastAccessedAt": return store === "thumbnail_cache" ? nullableNumber(object.lastAccessedAt) : null;
    case "byByteSize": return store === "thumbnail_cache" ? nullableNumber(object.byteSize) : null;
    default: throw new Error(`Неизвестный индекс IndexedDB: ${indexName}`);
  }
}

function nullableText(value) { return value === undefined || value === null || value === "" ? null : String(value); }
function nullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function toPublicRow(record) { return { key: record.key, value: record.value, updatedAt: Number(record.updatedAt || 0) }; }

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Операция IndexedDB не выполнена"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Транзакция IndexedDB не выполнена"));
    transaction.onabort = () => reject(transaction.error || new Error("Транзакция IndexedDB отменена"));
  });
}

function backupReplacer(_key, value) {
  if (value === undefined) return { __richCurrentType: "undefined" };
  if (typeof value === "bigint") return { __richCurrentType: "bigint", value: String(value) };
  return value;
}

function parseBackup(input) {
  let parsed;
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes), backupReviver);
  } catch {
    throw new Error("Файл не является резервной копией IndexedDB Post Manipulator");
  }
  if (parsed?.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION || !Array.isArray(parsed.records)) {
    throw new Error("Это не совместимая резервная копия IndexedDB Post Manipulator");
  }
  const records = parsed.records.map(record => {
    if (!VALID_STORES.has(record?.store) || typeof record?.key !== "string") {
      throw new Error("Резервная копия IndexedDB повреждена");
    }
    return { store: record.store, key: record.key, value: record.value, updatedAt: Number(record.updatedAt || 0) };
  });
  const createdAt = Number(parsed.createdAt || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error("Резервная копия IndexedDB не содержит корректную дату создания");
  }
  return { createdAt, records };
}

function backupReviver(_key, value) {
  if (value?.__richCurrentType === "undefined") return undefined;
  if (value?.__richCurrentType === "bigint") return BigInt(value.value);
  return value;
}
