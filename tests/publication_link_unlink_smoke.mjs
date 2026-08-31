import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { PublicationService } from "../js/telegram/PublicationService.js?v=1.5.9";

const values = new Map();
const db = {
  async get(store, key, fallback = null) { return structuredClone(values.get(`${store}:${key}`) ?? fallback); },
  async put(store, key, value) { values.set(`${store}:${key}`, structuredClone(value)); },
  async all(store) {
    return [...values]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) }));
  }
};
const record = {
  id: "publication_source",
  chatId: -1001234567890,
  messageId: 41,
  publishedAt: Date.now(),
  source: { title: "Source" },
  messageAst: {
    id: "root",
    type: "document",
    props: {},
    children: [{
      id: "paragraph",
      type: "paragraph",
      props: { text: ["Читайте ", { type: "link_relation", relation_id: "link_1", text: "продолжение", url: "https://t.me/c/1/2" }] },
      children: []
    }]
  }
};
await db.put("publications", record.id, record);
const edits = [];
const events = new EventBus();
const service = new PublicationService({
  db,
  events,
  client: { async editRichMessage(payload) { edits.push(payload); } },
  renderer: { renderEnvelope() { return { richMessage: { blocks: [] }, replyMarkup: { inline_keyboard: [] } }; }
  }
});

events.emit("links:changed", {
  reason: "removed",
  relation: { id: "link_1", source: { kind: "publication", id: record.id } }
});
await new Promise(resolve => setImmediate(resolve));
assert.equal(edits.length, 1);
assert.equal(edits[0].messageId, 41);
assert.equal((await db.get("publications", record.id)).messageAst.children[0].props.text, "Читайте продолжение");
service.stop();
console.log("publication_link_unlink_smoke: OK");
