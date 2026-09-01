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
let project = await store.createProject({ title: "Guide", firstPostTitle: "Map" });
const mapPost = project.posts[0];
const created = await store.createPost(project.id, { title: "Article" });
project = created.project;
const article = created.post;
const rootMap = project.posts[0].messageAst.children.find(node => node.type === "project_post_map");
const articleSlot = rootMap.props.slots[0];

const sent = [];
const edited = [];
const deleted = [];
let nextMessageId = 100;
const client = {
  async sendRichMessage(payload) {
    sent.push(payload);
    return { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000) };
  },
  async editRichMessage(payload) {
    edited.push(payload);
    return { message_id: payload.messageId };
  },
  async deleteMessage(chatId, messageId) {
    deleted.push({ chatId, messageId });
    return true;
  }
};
const service = new ProjectPublicationService({
  db,
  store,
  compiler: new ProjectCompiler(),
  validator: { validate: () => [] },
  client,
  renderer: { renderEnvelope: tree => ({ richMessage: tree.toJSON(), replyMarkup: { inline_keyboard: [] } }) },
  targets: { list: async () => [{
    chatId: -100777,
    title: "Production",
    type: "channel",
    status: "ready",
    commentsEnabled: true,
    discussionRights: { canDelete: true }
  }] }
});

await service.publishProject(project.id, -100777, { commentsEnabled: false });
assert.equal(sent.length, 2);
assert.match(JSON.stringify(sent[0].richMessage), new RegExp(`${rootMap.id}:slot:${articleSlot.id}`), "Map host must materialize before ordinary posts");
assert.equal(edited.length, 2, "second pass resolves production links after every post has an identity");

project = await store.getProject(project.id);
for (const post of project.posts) {
  assert.equal(post.publication.state, "published");
  assert.equal(post.deployments.production.chatId, -100777);
  assert.ok(post.deployments.production.messageId);
  const record = await db.get("publications", projectPublicationId(project.id, post.id));
  assert.equal(record.source.kind, "project");
  assert.equal(record.source.projectId, project.id);
  assert.equal(record.source.postId, post.id);
  assert.equal(record.pinned, false);
  assert.equal(record.commentsEnabled, false, "Project publishing can disable comments in a channel with a discussion group");
  assert.equal(hasUnappliedProductionChanges(project, post), false, "a freshly published post has no unapplied changes");
}

// A legacy publication without a compiled snapshot is still clean until an
// author changes that particular post directly.
await store.updateProject(project.id, draft => {
  const legacy = draft.posts.find(post => post.id === article.id);
  delete legacy.publication.productionContentSnapshot;
}, "simulate-legacy-publication");
project = await store.getProject(project.id);
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === article.id)), false, "an unchanged legacy publication does not require Apply");

const changedArticleAst = structuredClone(project.posts.find(post => post.id === article.id).messageAst);
changedArticleAst.children.find(node => node.type === "heading").props.text = "Article updated";
await store.savePostAst(project.id, article.id, changedArticleAst);
project = await store.getProject(project.id);
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === article.id)), true, "a changed source post requires an Apply action");
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === mapPost.id)), false, "a dependent Post Map does not show Apply for another post's edit");

const pinnedArticleRecord = await db.get("publications", projectPublicationId(project.id, article.id));
pinnedArticleRecord.pinned = true;
pinnedArticleRecord.pinnedAt = Date.now();
await db.put("publications", pinnedArticleRecord.id, pinnedArticleRecord);

edited.length = 0;
await service.applyChanges(project.id, article.id);
assert.equal(edited.length, 2, "editing a target post also refreshes dependent Project Maps");
project = await store.getProject(project.id);
assert.equal(hasUnappliedProductionChanges(project, project.posts.find(post => post.id === article.id)), false, "applying refreshes the production baseline");
assert.equal((await db.get("publications", projectPublicationId(project.id, article.id))).pinned, true, "editing a pinned Project post must preserve its pin state");

await assert.rejects(
  service.unpublishPost(project.id, mapPost.id),
  /Нельзя удалить карту проекта раньше связанных постов/,
  "a published Map must remain until its linked posts are unpublished"
);
await assert.rejects(
  service.discardPostProjection(project.id, mapPost.id),
  /Нельзя удалить карту проекта раньше связанных постов/,
  "local projection cleanup must not bypass the Map deletion order"
);
const mapProjectionId = projectPublicationId(project.id, mapPost.id);
const expiredMapRecord = await db.get("publications", mapProjectionId);
expiredMapRecord.deleteUntil = Date.now() - 1;
await db.put("publications", mapProjectionId, expiredMapRecord);
await assert.rejects(
  service.checkExpiredUnpublish(project.id, mapPost.id),
  /Нельзя удалить карту проекта раньше связанных постов/,
  "expired-publication cleanup must not bypass the Map deletion order"
);
expiredMapRecord.deleteUntil = Date.now() + 48 * 60 * 60 * 1000;
await db.put("publications", mapProjectionId, expiredMapRecord);
assert.equal(deleted.length, 0, "blocked Map cleanup must not call Telegram");

const articleProjectionId = projectPublicationId(project.id, article.id);
const expiredArticleRecord = await db.get("publications", articleProjectionId);
expiredArticleRecord.deleteUntil = Date.now() - 1;
await db.put("publications", articleProjectionId, expiredArticleRecord);
const deleteMessage = client.deleteMessage;
client.deleteMessage = async () => { throw { isMessageDeleteForbidden: () => true }; };
const expiredCheck = await service.checkExpiredUnpublish(project.id, article.id);
assert.equal(expiredCheck.remoteState, "present", "a Project projection is retained until the user confirms losing control of its old Telegram message");
assert.ok((await store.getProject(project.id)).posts.find(post => post.id === article.id).deployments.production);
client.deleteMessage = deleteMessage;
expiredArticleRecord.deleteUntil = Date.now() + 48 * 60 * 60 * 1000;
await db.put("publications", articleProjectionId, expiredArticleRecord);

edited.length = 0;
await service.unpublishPost(project.id, article.id);
project = await store.getProject(project.id);
assert.equal(deleted.length, 1, "Project projection can be removed from Telegram through its publication card");
assert.equal(project.posts.find(post => post.id === article.id).publication.state, "draft");
assert.equal(project.posts.find(post => post.id === article.id).deployments.production, undefined);
assert.equal(await db.get("publications", projectPublicationId(project.id, article.id)), null);
assert.equal(edited.length, 1, "removing a Project post refreshes its published Map");

await service.unpublishPost(project.id, mapPost.id);
project = await store.getProject(project.id);
assert.equal(deleted.length, 2, "the Map can be removed after every linked post");
assert.equal(project.posts.find(post => post.id === mapPost.id).publication.state, "draft");

console.log("project publication projection smoke: OK");
