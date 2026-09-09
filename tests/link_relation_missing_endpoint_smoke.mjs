import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { LinkRelationStore } from "../js/links/LinkRelationStore.js";
import { LinkingController } from "../js/links/LinkingController.js";
import { LinkRelationNavigator } from "../js/links/LinkRelationNavigator.js";
import { PublicationService } from "../js/telegram/PublicationService.js";
import { relationIdsInAst } from "../js/links/LinkRelationAst.js";

const ast = text => ({ id: "root", type: "document", props: {}, children: [{ id: "text", type: "paragraph", props: { text }, children: [] }] });
const marker = (id, text = "Read more") => ({ type: "link_relation", relation_id: id, text, url: "https://t.me/c/123/4" });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const values = new Map();
  const db = {
    async get(store, key, fallback = null) { return structuredClone(values.get(`${store}:${key}`) ?? fallback); },
    async put(store, key, value) { values.set(`${store}:${key}`, structuredClone(value)); },
    async delete(store, key) { values.delete(`${store}:${key}`); },
    async all(store) { return [...values].filter(([key]) => key.startsWith(`${store}:`)).map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) })); }
  };
  const events = new EventBus();
  const links = new LinkRelationStore({ db, events });
  const calls = [];
  const client = {
    async deleteMessage(...args) { calls.push(["delete", ...args]); },
    async editRichMessage() { calls.push(["edit"]); }
  };
  const publications = new PublicationService({ db, events, client, linkRelations: links });
  return { db, events, links, calls, client, publications };
}

for (const remoteState of ["present", "missing", "offline"]) {
  const { db, events, links, calls, client, publications } = fixture();
  const record = { id: "published", chatId: -100123, messageId: 4, publishedAt: Date.now(), messageAst: ast("Published") };
  await db.put("publications", record.id, record);
  await db.put("publications", "other", { id: "other", chatId: -100123, messageId: 5 });
  await db.put("projects", "project", { id: "project", posts: [{ id: "post", messageAst: ast("Project") }] });
  const source = { kind: "project_post", id: "project:post", nodeId: "text", property: "text" };
  const lost = await links.create({ source, target: { kind: "publication", id: record.id } });
  const valid = await links.create({ source, target: { kind: "publication", id: "other" } });
  const text = ["Keep ", marker(lost.id), " and ", marker(valid.id, "Other")];
  await db.put("projects", "project", { id: "project", posts: [{ id: "post", messageAst: ast(text) }] });
  await db.put("drafts", "copy", { id: "copy", messageAst: ast(text) });
  await db.put("publications", "copy", { id: "copy", messageAst: ast(text) });
  const live = ast([...text, " unsaved text"]);
  const tree = { walk(fn) { fn(live); live.children.forEach(fn); }, find(id) { return live.children.find(node => node.id === id); } };
  const controller = { updateNodeProperties(id, props) { tree.find(id).props = { ...props }; } };
  const linking = new LinkingController({ events, tree, controller, linkRelations: links }).start();
  await tick();
  const failure = Object.assign(new Error(remoteState), { isMessageMissing: () => remoteState === "missing" });
  if (remoteState !== "present") client.deleteMessage = async () => { calls.push(["delete"]); throw failure; };
  if (remoteState === "offline") {
    await assert.rejects(publications.delete(record.id), /offline/);
    assert.ok(await links.get(lost.id));
    assert.ok(await db.get("publications", record.id));
    assert.deepEqual(relationIdsInAst(live), [lost.id, valid.id]);
  } else {
    assert.equal(await publications.delete(record.id), true);
    await tick();
    assert.equal(await links.get(lost.id), null);
    assert.ok(await links.get(valid.id));
    for (const store of ["drafts", "publications"]) {
      assert.deepEqual(relationIdsInAst((await db.get(store, "copy")).messageAst), [valid.id]);
    }
    assert.deepEqual(relationIdsInAst((await db.get("projects", "project")).posts[0].messageAst), [valid.id]);
    assert.deepEqual(relationIdsInAst(live), [valid.id]);
    assert.equal(live.children[0].props.text.at(-1), " unsaved text", "cleanup must preserve unsaved text");
    assert.equal(calls.some(call => call[0] === "edit"), false, "local cleanup must not edit other Telegram messages");
  }
  linking.stop();
  publications.stop();
}

{
  const { db, links, publications, calls } = fixture();
  await db.put("drafts", "target", { id: "target", messageAst: ast("Target") });
  const orphan = await links.create({ source: { kind: "publication", id: "deleted_source" }, target: { kind: "draft", id: "target" } });
  await db.put("drafts", "copy", { id: "copy", messageAst: ast(marker(orphan.id)) });
  const navigator = new LinkRelationNavigator({ linkRelations: links, publications });
  assert.equal(await navigator.openTarget({ kind: "draft", id: "target" }), null);
  assert.deepEqual(await links.list(), [], "old orphaned sources must be repaired when opening their target");
  assert.equal((await db.get("drafts", "copy")).messageAst.children[0].props.text, "Read more");
  assert.deepEqual(calls, []);
  publications.stop();
}

{
  const { db, links, publications } = fixture();
  await db.put("drafts", "source", { id: "source", messageAst: ast("Source") });
  await db.put("publications", "scheduled", { id: "scheduled", source: { draftId: "target_draft" }, scheduledAt: Date.now() + 60000 });
  const pending = await links.create({ source: { kind: "draft", id: "source" }, target: { kind: "draft", id: "target_draft" } });
  assert.deepEqual(await links.reconcileMissingEndpoints(), [], "a scheduled draft target still exists as a publication");
  assert.ok(await links.get(pending.id));
  publications.stop();
}

console.log("link_relation_missing_endpoint_smoke: OK");
