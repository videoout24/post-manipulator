import { t } from "../i18n/index.js?v=1.8.0";
import { APP_DATABASE_STORES, IndexedDbAppDatabase } from "./IndexedDbAppDatabase.js?v=1.7.1";

export const APP_DATABASE_NAME_PREFIX = "post-manipulator-bot";

/**
 * Bot-scoped application database. No persistent database is opened until a
 * verified Telegram flow has established the publisher Bot ID.
 */
export class AppDatabase {
  constructor({ indexedDb = globalThis.indexedDB } = {}) {
    this.indexedDb = indexedDb;
    this.database = null;
    this.botId = 0;
    this.info = null;
  }

  async selectBot(botId) {
    const selectedBotId = validBotId(botId);
    if (!selectedBotId) throw new Error(t("storage.appDatabase.invalidBotIDForLocalDatabase"));
    if (this.botId && this.botId !== selectedBotId) {
      throw new Error(t("storage.appDatabase.cannotSwitchTheLocalDatabaseToAnother"));
    }
    if (!this.database) {
      this.botId = selectedBotId;
      this.database = new IndexedDbAppDatabase({
        indexedDb: this.indexedDb,
        databaseName: databaseNameForBot(selectedBotId)
      });
    }
    this.info = await this.database.open();
    return this.info;
  }

  open() {
    if (!this.database) return Promise.reject(new Error(t("storage.appDatabase.youMustFirstSelectABotID")));
    return this.database.open();
  }

  async get(store, key, fallback = null) {
    return (await this.#ready()).get(store, key, fallback);
  }

  async put(store, key, value) {
    return (await this.#ready()).put(store, key, value);
  }

  async delete(store, key) {
    return (await this.#ready()).delete(store, key);
  }

  async clear(store) {
    return (await this.#ready()).clear(store);
  }

  async all(store) {
    return (await this.#ready()).all(store);
  }

  async indexAll(store, indexName, query = null) {
    return (await this.#ready()).indexAll(store, indexName, normalizeIndexQuery(query));
  }

  async exportBackup() {
    return (await this.#ready()).exportBackup();
  }

  async restoreBackup(bytes) {
    const database = await this.#ready();
    const source = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(await bytes?.arrayBuffer?.() || bytes || 0);
    const result = await database.restoreBackup(source);
    this.info = database.info;
    return result;
  }

  async close() {
    await this.database?.close();
    this.database = null;
    this.botId = 0;
    this.info = null;
  }

  async #ready() {
    await this.open();
    return this.database;
  }
}

export function databaseNameForBot(botId) {
  const selectedBotId = validBotId(botId);
  if (!selectedBotId) throw new Error(t("storage.appDatabase.invalidBotIDForLocalDatabaseName"));
  return `${APP_DATABASE_NAME_PREFIX}-${selectedBotId}`;
}

function validBotId(value) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeIndexQuery(query) {
  if (query == null) return null;
  if (typeof query === "object" && "lower" in query && query.lower === query.upper) return query.lower;
  return query;
}

export const APP_DB_STORES = APP_DATABASE_STORES;
