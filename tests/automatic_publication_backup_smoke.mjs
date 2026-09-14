import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import {
  AUTOMATIC_PUBLICATION_BACKUP_KEY,
  AutomaticPublicationBackup
} from "../js/storage/AutomaticPublicationBackup.js";

const settings = new Map();
const db = {
  async get(store, key, fallback) { return settings.get(`${store}:${key}`) ?? fallback; }
};
const events = new EventBus();
let created = 0;
const controller = new AutomaticPublicationBackup({
  db,
  events,
  backups: { async createAndPin() { created += 1; return { createdAt: Date.now() }; } }
}).start();

events.emit("telegram:publication-created", { id: "draft-publication" });
await controller.running;
assert.equal(created, 0, "automatic backups must be disabled by default");

settings.set(`settings:${AUTOMATIC_PUBLICATION_BACKUP_KEY}`, true);
events.emit("telegram:publication-created", { id: "draft-publication" });
await controller.running;
assert.equal(created, 1);

events.emit("project:publication", { state: "updating" });
await Promise.resolve();
assert.equal(created, 1, "an edit must not be treated as a new publication");

events.emit("project:publication", { state: "published" });
await controller.running;
events.emit("telegram:publication-deleted", { id: "removed-publication" });
await controller.running;
assert.equal(created, 3);

controller.stop();
console.log("automatic publication backup smoke: OK");
