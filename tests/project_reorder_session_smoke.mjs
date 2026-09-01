import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { ProjectStore, getProjectRootMap } from "../js/project/ProjectStore.js?v=1.7.6";
import { ProjectEditorSession } from "../js/project/ProjectEditorSession.js?v=1.7.6";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  #store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(name, key, fallback = null) { return this.#store(name).has(key) ? structuredClone(this.#store(name).get(key)) : fallback; }
  async put(name, key, value) { this.#store(name).set(key, structuredClone(value)); return value; }
  async delete(name, key) { return this.#store(name).delete(key); }
  async all(name) { return [...this.#store(name)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const db = new MemoryDb();
const events = new EventBus();
const store = new ProjectStore({ db, events });
let project = await store.createProject({ title: "Order", firstPostTitle: "Map" });
const rootId = project.posts[0].id;
const first = await store.createPost(project.id, { title: "First" });
const second = await store.createPost(project.id, { title: "Second" });
project = second.project;
const firstId = first.post.id;
const secondId = second.post.id;

const tree = {
  root: null,
  toJSON() { return structuredClone(this.root); }
};
const session = new ProjectEditorSession({ store, tree, db, events, storage: { clear() {} } });
await session.openProject(project.id, { postId: rootId, preserveScratch: true });

let reorderEvent = null;
events.on("project:changed", event => { if (event.reason === "post-reordered") reorderEvent = event; });
await session.movePostInMap(secondId, "up");

assert.deepEqual(session.project.posts.map(post => post.id), [rootId, secondId, firstId],
  "canonical post order follows the reordered map slots");
assert.deepEqual(getProjectRootMap(session.project).props.slots.map(slot => slot.targetPostId), [secondId, firstId]);
assert.deepEqual(getProjectRootMap({ ...session.project, posts: [{ ...session.project.posts[0], messageAst: tree.toJSON() }] }).props.slots.map(slot => slot.targetPostId), [secondId, firstId],
  "the open Canvas tree is immediately replaced with the reordered canonical map");
assert.deepEqual(reorderEvent?.affectedPostIds, [rootId],
  "the map host is the structural post that preview and production must rebuild");

await session.deletePost(secondId);
assert.equal(session.project.posts.some(post => post.id === secondId), false);
assert.deepEqual(getProjectRootMap(session.project).props.slots.map(slot => slot.targetPostId), [firstId],
  "deleting a post also removes its map slot");
assert.deepEqual(getProjectRootMap({ ...session.project, posts: [{ ...session.project.posts[0], messageAst: tree.toJSON() }] }).props.slots.map(slot => slot.targetPostId), [firstId],
  "deleting another post refreshes the open map in Canvas");

console.log("project_reorder_session_smoke: OK");
