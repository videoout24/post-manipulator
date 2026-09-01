import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { ProjectStore, getProjectRootMap } from "../js/project/ProjectStore.js?v=1.7.6";
import { ProjectCompiler } from "../js/project/ProjectCompiler.js?v=1.5.9";
import { ProjectPublicationService } from "../js/project/ProjectPublicationService.js?v=1.7.6";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  #store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(name, key, fallback = null) { return this.#store(name).has(key) ? structuredClone(this.#store(name).get(key)) : fallback; }
  async put(name, key, value) { this.#store(name).set(key, structuredClone(value)); return value; }
  async delete(name, key) { return this.#store(name).delete(key); }
  async all(name) { return [...this.#store(name)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const waitFor = async predicate => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("automatic structure projection did not finish");
};

const db = new MemoryDb();
const events = new EventBus();
const store = new ProjectStore({ db, events });
let project = await store.createProject({ title: "Published order", firstPostTitle: "Map" });
const rootId = project.posts[0].id;
const first = await store.createPost(project.id, { title: "First" });
const second = await store.createPost(project.id, { title: "Second" });
project = second.project;

const edited = [];
let nextMessageId = 50;
const target = { chatId: -100500, title: "Channel", type: "channel", status: "ready", commentsEnabled: false };
const service = new ProjectPublicationService({
  db,
  store,
  compiler: new ProjectCompiler(),
  validator: { validate: () => [] },
  client: {
    async sendRichMessage() { return { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000) }; },
    async editRichMessage(payload) { edited.push(payload); return { message_id: payload.messageId }; }
  },
  renderer: { renderEnvelope: tree => ({ richMessage: tree.toJSON(), replyMarkup: { inline_keyboard: [] } }) },
  targets: { list: async () => [target] },
  events
});

await service.publishPost(project.id, rootId, target.chatId, { commentsEnabled: false });
edited.length = 0;
await store.movePost(project.id, second.post.id, "up");
await waitFor(() => edited.length === 1);
let rendered = JSON.stringify(edited.at(-1).richMessage);
assert.ok(rendered.indexOf("Second") < rendered.indexOf("First"),
  "reordering automatically rerenders the already published map in the new slot order");
assert.deepEqual(getProjectRootMap(await store.getProject(project.id)).props.slots.map(slot => slot.targetPostId), [second.post.id, first.post.id]);

await store.deletePost(project.id, second.post.id);
await waitFor(() => edited.length === 2);
rendered = JSON.stringify(edited.at(-1).richMessage);
assert.doesNotMatch(rendered, /Second/);
assert.match(rendered, /First/);
service.stop();

console.log("project_structure_projection_sync_smoke: OK");
