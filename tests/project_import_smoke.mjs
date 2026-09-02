import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ProjectStore, getProjectRootMap } from "../js/project/ProjectStore.js?v=1.7.15";
import { parseProjectImportText } from "../js/project/ProjectImport.js?v=1.7.15";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  #store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(name, key, fallback = null) { const rows = this.#store(name); return rows.has(key) ? structuredClone(rows.get(key)) : fallback; }
  async put(name, key, value) { this.#store(name).set(key, structuredClone(value)); return value; }
  async delete(name, key) { return this.#store(name).delete(key); }
  async all(name) { return [...this.#store(name)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const sourceText = await readFile(new URL("../data/test-projects/project-01.json", import.meta.url), "utf8");
const [source] = parseProjectImportText(sourceText, { baseUrl: "https://example.test/app/" });
assert.equal(source.posts.length, 10);
const photo = findNode(source.posts[0].messageAst, node => node.type === "photo");
assert.match(photo.props.fileId, /^https:\/\/example\.test\/app\/assets\/test-projects\/test-01\.png$/);

// Imported publication identities belong to another environment and must never
// be able to edit or delete Telegram messages after a project is copied.
source.posts[0].schedule = { scheduledAt: Date.now() + 60_000, chatId: -1001 };
source.posts[0].publication = { state: "published", publishedAt: Date.now() };
source.posts[0].deployments = { production: { chatId: -1001, messageId: 99 } };

const db = new MemoryDb();
const store = new ProjectStore({ db });
const first = await store.importProjects([source]);
assert.equal(first.count, 1);
assert.equal(first.projects[0].posts.length, 10);
assert.equal(first.projects[0].posts[0].schedule, null);
assert.deepEqual(first.projects[0].posts[0].publication, { state: "draft" });
assert.deepEqual(first.projects[0].posts[0].deployments, {});
assert.equal(getProjectRootMap(first.projects[0]).props.slots.length, 9);

const second = await store.importProjects([source]);
assert.equal((await store.listProjects()).length, 2, "reimport adds a copy instead of overwriting");
assert.notEqual(second.projects[0].id, first.projects[0].id);
assert.match(second.projects[0].title, /\(импорт 2\)|\(import 2\)/);

const countBeforeInvalidImport = (await store.listProjects()).length;
await assert.rejects(
  () => store.importProjects([source, { id: "broken", title: "Broken", posts: [] }]),
  /проект|project/i
);
assert.equal((await store.listProjects()).length, countBeforeInvalidImport, "validation happens before writes");
assert.throws(() => parseProjectImportText('{"format":"unknown"}'), /формат|format/i);

console.log("project import smoke: OK");

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}
