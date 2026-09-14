export const AUTOMATIC_PUBLICATION_BACKUP_KEY = "automaticPublicationBackups";

export class AutomaticPublicationBackup {
  constructor({ db, events = null, backups, onCreated = null, onError = null } = {}) {
    this.db = db;
    this.events = events;
    this.backups = backups;
    this.onCreated = onCreated;
    this.onError = onError;
    this.unsubscribers = [];
    this.pending = false;
    this.running = null;
  }

  start() {
    this.unsubscribers.push(
      this.events?.on?.("telegram:publication-created", () => this.request("published")),
      this.events?.on?.("telegram:publication-deleted", () => this.request("deleted")),
      this.events?.on?.("project:publication", event => {
        if (event?.state === "published") this.request("published");
      })
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  async isEnabled() {
    return Boolean(await this.db?.get?.("settings", AUTOMATIC_PUBLICATION_BACKUP_KEY, false));
  }

  request(reason = "publication-changed") {
    this.pending = true;
    if (!this.running) this.running = this.#drain(reason).finally(() => { this.running = null; });
    return this.running;
  }

  async #drain(reason) {
    while (this.pending) {
      this.pending = false;
      if (!await this.isEnabled()) continue;
      try {
        const result = await this.backups?.createAndPin?.();
        this.onCreated?.(result, reason);
      } catch (error) {
        this.onError?.(error, reason);
      }
    }
  }
}
