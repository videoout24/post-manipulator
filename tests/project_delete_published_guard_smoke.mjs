import assert from "node:assert/strict";
import { ProjectStore } from "../js/project/ProjectStore.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  #store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(name, key, fallback = null) { return this.#store(name).has(key) ? structuredClone(this.#store(name).get(key)) : fallback; }
  async put(name, key, value) { this.#store(name).set(key, structuredClone(value)); return value; }
  async delete(name, key) { return this.#store(name).delete(key); }
  async all(name) { return [...this.#store(name)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const store = new ProjectStore({ db: new MemoryDb() });
let project = await store.createProject({ title: "Published project", firstPostTitle: "First" });
const postId = project.posts[0].id;
await store.savePostProduction(project.id, postId, {
  deployment: { chatId: -1001, messageId: 55 },
  publishedAt: Date.now()
});

await assert.rejects(
  store.deleteProject(project.id),
  error => error.message === t("project.projectStore.youCannotDeleteTheProjectWhileIt")
);
await assert.rejects(
  store.deletePost(project.id, postId),
  error => error.message === t("project.projectStore.cannotDeleteAPublishedProjectPostFirst")
);
assert.ok(await store.getProject(project.id), "the published Project must remain available for publication cleanup");

await store.clearPostProduction(project.id, postId);
assert.equal(await store.deleteProject(project.id), true);
assert.equal(await store.getProject(project.id), null);

console.log("project_delete_published_guard_smoke: OK");
