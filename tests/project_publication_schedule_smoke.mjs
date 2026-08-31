import assert from "node:assert/strict";
import { ProjectStore } from "../js/project/ProjectStore.js?v=1.5.9";
import { ProjectCompiler } from "../js/project/ProjectCompiler.js?v=1.5.9";
import { ProjectPublicationService, projectPublicationId } from "../js/project/ProjectPublicationService.js?v=1.5.9";
import { hasUnappliedProductionChanges } from "../js/project/ProjectPublicationState.js?v=1.5.9";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  #store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { const rows = this.#store(store); return rows.has(key) ? structuredClone(rows.get(key)) : fallback; }
  async put(store, key, value) { this.#store(store).set(key, structuredClone(value)); return value; }
  async delete(store, key) { return this.#store(store).delete(key); }
  async all(store) { return [...this.#store(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const db = new MemoryDb();
const store = new ProjectStore({ db });
let project = await store.createProject({ title: "Scheduled guide", firstPostTitle: "First" });
const first = project.posts[0];
const { post: second } = await store.createPost(project.id, { title: "Second" });
const sent = [];
const edited = [];
let messageId = 10;
const client = {
  async sendRichMessage(payload) {
    sent.push(payload);
    return { message_id: messageId++, date: Math.floor(Date.now() / 1000) };
  },
  async editRichMessage(payload) { edited.push(payload); return { message_id: payload.messageId }; },
  async deleteMessage() { return true; }
};
const target = {
  chatId: -100550,
  title: "Scheduled channel",
  type: "channel",
  status: "ready",
  commentsEnabled: true,
  discussionRights: { canDelete: true }
};
const service = new ProjectPublicationService({
  db,
  store,
  compiler: new ProjectCompiler(),
  validator: { validate: () => [] },
  client,
  renderer: { renderEnvelope: tree => ({ richMessage: tree.toJSON(), replyMarkup: { inline_keyboard: [] } }) },
  targets: { list: async () => [target] }
});
await service.initialize();

const scheduledAt = Date.now() + 35;
await service.schedulePost(project.id, first.id, target.chatId, { scheduledAt, commentsEnabled: false });
project = await store.getProject(project.id);
assert.equal(project.posts.find(post => post.id === first.id).publication.state, "scheduled");
assert.equal(project.posts.find(post => post.id === first.id).schedule.commentsEnabled, false);
let record = await db.get("publications", projectPublicationId(project.id, first.id));
assert.equal(record.scheduledAt, scheduledAt);
assert.equal(record.commentsEnabled, false);
assert.equal(record.messageId, null);

await new Promise(resolve => setTimeout(resolve, 90));
project = await store.getProject(project.id);
assert.equal(sent.length, 1, "the durable schedule publishes when its time arrives while the app is open");
assert.equal(project.posts.find(post => post.id === first.id).publication.state, "published");
record = await db.get("publications", projectPublicationId(project.id, first.id));
assert.equal(record.scheduledAt, null);
assert.ok(record.messageId);
assert.equal(record.commentsEnabled, false);

const secondScheduledAt = Date.now() + 5 * 60_000;
await service.schedulePost(project.id, second.id, target.chatId, { scheduledAt: secondScheduledAt, commentsEnabled: true });
assert.equal(edited.length, 1, "scheduling a target refreshes its published Post Map");
assert.match(JSON.stringify(edited[0].richMessage), /🕒/, "the published Map shows the scheduled state");
const scheduledMapEntry = edited[0].richMessage.children.find(block => (
  Array.isArray(block?.props?.text)
  && block.props.text.some(part => part?.type === "date_time")
));
assert.deepEqual(scheduledMapEntry?.props?.text?.[0], {
  type: "date_time",
  text: "🕒",
  unix_time: Math.floor(secondScheduledAt / 1000),
  date_time_format: ""
}, "the scheduled icon carries the Telegram date/time timestamp");
project = await store.getProject(project.id);
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === first.id)), false, "the refreshed Map has no pending production change");
await service.cancelPostSchedule(project.id, second.id);
assert.equal(edited.length, 2, "cancelling a schedule refreshes its published Post Map");
assert.match(JSON.stringify(edited[1].richMessage), /📝/, "the published Map returns to the draft state");
project = await store.getProject(project.id);
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === first.id)), false, "the restored Map baseline stays current");
assert.equal(project.posts.find(post => post.id === second.id).publication.state, "draft");
assert.equal(await db.get("publications", projectPublicationId(project.id, second.id)), null);
service.stop();

console.log("project publication schedule smoke: OK");
