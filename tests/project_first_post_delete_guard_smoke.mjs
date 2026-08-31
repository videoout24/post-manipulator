import assert from "node:assert/strict";
import { ProjectStore } from "../js/project/ProjectStore.js?v=1.5.9";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(name, key, fallback = null) { return this.store(name).has(key) ? structuredClone(this.store(name).get(key)) : fallback; }
  async put(name, key, value) { this.store(name).set(key, structuredClone(value)); return value; }
  async delete(name, key) { return this.store(name).delete(key); }
  async all(name) { return [...this.store(name)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const store = new ProjectStore({ db: new MemoryDb() });
let project = await store.createProject({ title: "Проект", firstPostTitle: "Главный пост" });
const firstId = project.posts[0].id;
const created = await store.createPost(project.id, { title: "Второй пост" });
const secondId = created.post.id;

project = await store.deletePost(project.id, secondId);
assert.deepEqual(project.posts.map(post => post.id), [firstId]);
assert.deepEqual(project.posts[0].messageAst.children.find(node => node.type === "project_post_map").props.slots, []);

await store.deletePost(project.id, firstId);
assert.equal(await store.getProject(project.id), null, 'deleting the start post removes the whole Project');

console.log("project_first_post_delete_guard_smoke: OK");
