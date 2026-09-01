import assert from "node:assert/strict";
import { DraftStore } from "../js/editor/DraftStore.js?v=1.7.13";
import { PublicationService } from "../js/telegram/PublicationService.js?v=1.7.13";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  store(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name);
  }
  async get(store, key, fallback = null) {
    const rows = this.store(store);
    return rows.has(key) ? structuredClone(rows.get(key)) : fallback;
  }
  async put(store, key, value) {
    this.store(store).set(key, structuredClone(value));
    return value;
  }
  async delete(store, key) { return this.store(store).delete(key); }
  async all(store) {
    return [...this.store(store)].map(([key, value]) => ({ key, value: structuredClone(value) }));
  }
}

const paragraph = text => ({
  id: "root",
  type: "document",
  props: {},
  children: [{ id: `p-${text}`, type: "paragraph", props: { text }, children: [] }]
});

async function waitFor(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

const db = new MemoryDb();
const drafts = new DraftStore({ db });
const target = {
  chatId: -100500,
  type: "channel",
  title: "Schedule",
  status: "ready",
  commentsEnabled: true,
  discussionRights: { canDelete: true }
};
const sent = [];
const edited = [];
const scheduleErrors = [];
let nextMessageId = 70;
const client = {
  async sendRichMessage(payload) {
    sent.push(payload);
    return { message_id: nextMessageId++, date: Math.floor(Date.now() / 1000) };
  },
  async editRichMessage(payload) { edited.push(payload); return { message_id: payload.messageId }; }
};
const cleared = [];
const dependencies = {
  db,
  drafts,
  client,
  events: {
    on() { return () => {}; },
    emit(name, payload) {
      if (name === "telegram:draft-publication-schedule-error") scheduleErrors.push(payload?.message || String(payload?.error || "unknown"));
    }
  },
  targets: { async list() { return [target]; } },
  validator: { validate() { return []; } },
  renderer: { renderEnvelope(tree) { return { richMessage: tree.root, replyMarkup: { inline_keyboard: [] } }; } },
  documents: { async clearScheduledDraft(id) { cleared.push(id); return true; } },
  linkRelations: {
    async bindSourceDraftToPublication() { return []; },
    async bindSourcePublicationToDraft() { return []; },
    async bindTargetPublicationToDraft() { return []; },
    async reconcileSource() { return []; },
    async materializeAst(ast) { return structuredClone(ast); },
    async resolveWaitingForPublication() { return []; }
  }
};

const service = new PublicationService(dependencies);
const original = await drafts.create({ title: "Отложенный", messageAst: paragraph("Первая версия"), source: { kind: "draft" } });
const scheduledAt = Date.now() + 5 * 60_000;
const scheduled = await service.scheduleDraft(original.id, target.chatId, { scheduledAt, commentsEnabled: false });
assert.equal(await drafts.get(original.id), null, "scheduled material leaves the ordinary Draft list");
assert.deepEqual(cleared, [original.id]);
assert.equal(scheduled.scheduledAt, scheduledAt);
assert.equal(scheduled.messageId, null);
assert.equal(scheduled.commentsEnabled, false);

const editDraft = await service.createEditDraft(scheduled.id);
assert.equal(editDraft.source.scheduledAt, scheduledAt, "the editor knows it is changing a scheduled publication");
await drafts.saveAst(editDraft.id, paragraph("Версия перед отправкой"));
const updatedSchedule = await service.applyDraftChanges(editDraft.id);
assert.equal(updatedSchedule.scheduledAt, scheduledAt, "editing keeps the original delivery time");
assert.equal(updatedSchedule.messageAst.children[0].props.text, "Версия перед отправкой");
assert.equal(edited.length, 0, "editing a scheduled Draft does not call Telegram before its time");

const restored = await service.cancelDraftSchedule(scheduled.id);
assert.equal(restored.id, original.id, "cancellation restores the same Draft identity");
assert.equal(restored.messageAst.children[0].props.text, "Версия перед отправкой");
assert.equal(await db.get("publications", scheduled.id), null);
assert.equal((await drafts.list()).some(draft => draft.id === editDraft.id), false, "stale editor copy is removed on cancellation");

const dueDraft = await drafts.create({ title: "Просроченный", messageAst: paragraph("Уйдёт после запуска") });
const pending = await service.scheduleDraft(dueDraft.id, target.chatId, {
  scheduledAt: Date.now() + 5 * 60_000,
  commentsEnabled: true
});
service.stop();
const overdue = await db.get("publications", pending.id);
overdue.scheduledAt = Date.now() - 1000;
await db.put("publications", overdue.id, overdue);

const restarted = new PublicationService(dependencies);
await restarted.initialize();
assert.equal(await waitFor(async () => (await db.get("publications", pending.id))?.scheduledAt === null), true,
  `the overdue timer must finish within the smoke-test timeout; errors: ${scheduleErrors.join(" | ") || "none"}`);
const published = await db.get("publications", pending.id);
assert.equal(sent.length, 1, "an overdue Draft publishes when the application starts again");
assert.equal(published.scheduledAt, null);
assert.ok(published.messageId);
assert.equal(published.messageAst.children[0].props.text, "Уйдёт после запуска");
restarted.stop();

console.log("draft publication schedule smoke: OK");
