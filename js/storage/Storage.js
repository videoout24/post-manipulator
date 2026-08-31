export class Storage {
  constructor(_key = "rich-message-builder", { db = null, initialValue = null } = {}) {
    this.db = db;
    this.value = initialValue;
  }

  static async create({ db } = {}) {
    const value = await db?.get?.("settings", "editor.document", null);
    return new Storage(undefined, { db, initialValue: value });
  }

  save(tree) {
    this.value = structuredClone(tree);
    if (this.db) {
      this.db.put("settings", "editor.document", this.value).catch(error => console.error("IndexedDB document save failed", error));
    }
  }

  load() {
    return this.value == null ? null : structuredClone(this.value);
  }

  clear() {
    this.value = null;
    if (this.db) {
      this.db.delete("settings", "editor.document").catch(error => console.error("IndexedDB document clear failed", error));
    }
  }
}
