import assert from "node:assert/strict";
import { DraftStore } from "../js/editor/DraftStore.js";
import { PublicationService, isPublicationDeleteAvailable, publicationDeleteHoursLeft } from "../js/telegram/PublicationService.js?v=1.5.9";
import { t } from "../js/i18n/index.js?v=1.8.0";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  s(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { return structuredClone(this.s(store).get(key) ?? fallback); }
  async put(store, key, value) { this.s(store).set(key, structuredClone(value)); return value; }
  async delete(store, key) { this.s(store).delete(key); }
  async all(store) { return [...this.s(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const db = new MemoryDb();
const draft = { id: "d1", title: "Draft", messageAst: { id: "root", type: "document", props: {}, children: [{ id: "p", type: "paragraph", props: { text: "Hello" }, children: [] }] } };
const drafts = new DraftStore({ db });
await drafts.restore(draft);
const sent = [];
const deleted = [];
const pinned = [];
const cleared = [];
const client = {
  async sendRichMessage(payload) { sent.push(payload); return { message_id: 42, date: 1000 }; },
  async deleteMessage(chatId, messageId) { deleted.push([chatId, messageId]); return true; },
  async pinChatMessage(chatId, messageId, options) { pinned.push(["pin", chatId, messageId, options]); return true; },
  async unpinChatMessage(chatId, messageId) { pinned.push(["unpin", chatId, messageId]); return true; }
};
const target = { chatId: -1001, type: "channel", title: "News", status: "ready", commentsEnabled: true, linkedDiscussionChatId: -2001 };
const service = new PublicationService({
  db, client, drafts, targets: { async list() { return [target]; } },
  validator: { validate() { return []; } },
  renderer: { renderEnvelope() { return { richMessage: { blocks: [] }, replyMarkup: { inline_keyboard: [] } }; } },
  documents: { async clearPublishedDraft(id) {
    cleared.push(id);
    return true;
  } }
});

const record = await service.publishDraft("d1", -1001, { commentsEnabled: true });
assert.equal(sent.length, 1);
assert.deepEqual((await drafts.get("d1")).messageAst, draft.messageAst, "publishing preserves the original source");
assert.equal((await drafts.get("d1")).source.publicationId, record.id);
assert.equal((await drafts.get("d1")).source.retained, true);
assert.deepEqual(cleared, [], "publishing keeps the active source draft open");
await assert.rejects(drafts.delete("d1"), error => error.message === t("editor.draftListView.deletePublishedDraftBlocked"));
await assert.rejects(drafts.assertCanMoveToProject("d1"), error => error.message === t("editor.draftListView.movePublishedDraftBlocked"));
await assert.rejects(service.publishDraft("d1", -1001), error => error.message === t("editor.draftListView.draftAlreadyPublished"));
assert.equal(sent.length, 1, "a linked draft cannot create a duplicate publication");
const renamed = await drafts.rename("d1", "Renamed source");
assert.equal(renamed.title, "Renamed source");
assert.equal(renamed.source.publicationId, record.id, "renaming preserves the publication link");
assert.equal(record.messageId, 42);
assert.equal(record.pinned, false);
assert.equal(publicationDeleteHoursLeft(record, record.publishedAt), 48);
assert.equal(publicationDeleteHoursLeft({ publishedAt: record.publishedAt }, record.publishedAt), 48, "legacy Project projections use their publication time as the deletion deadline");
assert.equal(isPublicationDeleteAvailable(record, record.deleteUntil - 1), true);
assert.equal(isPublicationDeleteAvailable(record, record.deleteUntil), false);

await service.handleUpdate({ message: {
  message_id: 70, chat: { id: -2001 }, is_automatic_forward: true,
  forward_origin: { type: "channel", chat: { id: -1001 }, message_id: 42 }
} });
let stored = (await service.list())[0];
assert.equal(stored.discussionMessageId, 70);

const pinnedRecord = await service.setPinned(record.id, true);
assert.equal(pinnedRecord.pinned, true);
assert.ok(pinnedRecord.pinnedAt);
assert.deepEqual(pinned[0], ["pin", -1001, 42, { disableNotification: true }]);
assert.deepEqual(pinned[1], ["pin", -2001, 70, { disableNotification: true }], "discussion message must be pinned with its channel post");
assert.equal((await db.get("publications", record.id)).pinned, true);
const unpinnedRecord = await service.setPinned(record.id, false);
assert.equal(unpinnedRecord.pinned, false);
assert.equal(unpinnedRecord.pinnedAt, null);
assert.deepEqual(pinned[2], ["unpin", -1001, 42]);
assert.deepEqual(pinned[3], ["unpin", -2001, 70], "discussion message must be unpinned with its channel post");

const pinMessage = client.pinChatMessage;
client.pinChatMessage = async (chatId, messageId, options) => {
  pinned.push(["pin", chatId, messageId, options]);
  if (chatId === -2001) throw new Error("discussion pin denied");
  return true;
};
await assert.rejects(
  service.setPinned(record.id, true),
  error => error.message === t("telegram.publicationService.failedToSynchronizePinningOfThePost", { 0: "discussion pin denied" })
);
assert.deepEqual(pinned.slice(-3).map(item => item.slice(0, 3)), [
  ["pin", -1001, 42],
  ["pin", -2001, 70],
  ["unpin", -1001, 42]
], "a failed discussion pin must roll the channel pin back");
assert.equal((await db.get("publications", record.id)).pinned, false);
client.pinChatMessage = pinMessage;

const pendingPinRecord = {
  ...(await db.get("publications", record.id)),
  id: "pending-pin",
  messageId: 43,
  discussionMessageId: null,
  pinned: false,
  pinnedAt: null
};
await db.put("publications", pendingPinRecord.id, pendingPinRecord);
const pendingPinned = await service.setPinned(pendingPinRecord.id, true);
assert.equal(pendingPinned.pinned, true, "the channel post can be pinned before Telegram exposes the discussion identity");
assert.deepEqual(pinned.at(-1), ["pin", -1001, 43, { disableNotification: true }]);

const lateForwardRecord = {
  ...(await db.get("publications", pendingPinRecord.id)),
  id: "late-forward"
};
await db.delete("publications", pendingPinRecord.id);
await db.put("publications", lateForwardRecord.id, lateForwardRecord);
await service.handleUpdate({ message: {
  message_id: 73, chat: { id: -2001 }, is_automatic_forward: true,
  forward_origin: { type: "channel", chat: { id: -1001 }, message_id: 43 }
} });
assert.deepEqual(pinned.at(-1), ["pin", -2001, 73, { disableNotification: true }],
  "a late automatic forward must inherit an existing channel pin");
assert.equal((await db.get("publications", lateForwardRecord.id)).discussionMessageId, 73,
  "discussion identity must be stored before late pin housekeeping");
await db.delete("publications", lateForwardRecord.id);

const recoveredRecord = {
  ...(await db.get("publications", record.id)),
  id: "recovered-from-comment",
  messageId: 44,
  discussionMessageId: null,
  commentMessageIds: [],
  commentCount: 0,
  pinned: false,
  pinnedAt: null
};
await db.put("publications", recoveredRecord.id, recoveredRecord);
await service.handleUpdate({ message: {
  message_id: 75,
  chat: { id: -2001 },
  message_thread_id: 74,
  reply_to_message: {
    message_id: 74,
    is_automatic_forward: true,
    forward_origin: { type: "channel", chat: { id: -1001 }, message_id: 44 }
  }
} });
const recovered = await db.get("publications", recoveredRecord.id);
assert.equal(recovered.discussionMessageId, 74, "a comment must recover a missed automatic-forward identity");
assert.deepEqual(recovered.commentMessageIds, [75]);
await db.delete("publications", recoveredRecord.id);

const expired = { ...record, id: "expired", deleteUntil: record.publishedAt + 1 };
await db.put("publications", expired.id, expired);
client.deleteMessage = async () => { throw { isMessageDeleteForbidden: () => true }; };
const present = await service.checkExpiredDeletion(expired.id);
assert.equal(present.remoteState, "present", "an old message that Telegram refuses to delete remains under a local index until confirmed");
assert.ok(await db.get("publications", expired.id));
client.deleteMessage = async () => { throw { isMessageMissing: () => true }; };
const missing = await service.checkExpiredDeletion(expired.id);
assert.equal(missing.remoteState, "missing");
await service.discardLocal(expired.id);
assert.equal(await db.get("publications", expired.id), null);

await service.handleUpdate({ message: { message_id: 71, chat: { id: -2001 }, reply_to_message: { message_id: 70 } } });
await service.handleUpdate({ message: { message_id: 72, chat: { id: -2001 }, message_thread_id: 70, reply_to_message: { message_id: 71 } } });
await service.handleUpdate({ message_reaction_count: { chat: { id: -1001 }, message_id: 42, reactions: [
  { type: { type: "emoji", emoji: "👍" }, total_count: 3 },
  { type: { type: "emoji", emoji: "🔥" }, total_count: 2 }
] } });
stored = (await service.list())[0];
assert.equal(stored.commentCount, 2);
assert.equal(stored.reactionCount, 5);
assert.deepEqual(stored.reactions.map(item => [item.type.emoji, item.total_count]), [["👍", 3], ["🔥", 2]]);

const editDraft = await service.createEditDraft(record.id);
assert.equal(editDraft.id, "d1", "editing reuses the retained source draft");
assert.equal(editDraft.source.publicationId, record.id);
client.editRichMessage = async payload => { sent.push({ edit: payload }); return { message_id: 42 }; };
editDraft.messageAst.children[0].props.text = "Updated";
await drafts.saveAst(editDraft.id, editDraft.messageAst);
const updated = await service.applyDraftChanges(editDraft.id);
assert.equal(updated.messageAst.children[0].props.text, "Updated");
assert.equal(updated.source.title, "Renamed source");
assert.equal((await drafts.get("d1")).messageAst.children[0].props.text, "Updated");
assert.equal(sent.at(-1).edit.messageId, 42);

const deletablePublishedAt = Date.now();
const deletableMissingRecord = {
  ...updated,
  publishedAt: deletablePublishedAt,
  deleteUntil: deletablePublishedAt + 48 * 60 * 60 * 1000
};
await db.put("publications", record.id, deletableMissingRecord);
client.deleteMessage = async () => { throw { isMessageMissing: () => true }; };
assert.equal(await service.delete(record.id), true,
  "a message already removed from its channel or group must still be removable from the local publications tab");
assert.equal(await db.get("publications", record.id), null);
const retained = await drafts.get("d1");
assert.equal(retained.title, "Renamed source");
assert.equal(retained.messageAst.children[0].props.text, "Updated");
assert.equal(retained.source, null, "deleting the publication releases the source draft");
await drafts.assertCanMoveToProject(retained.id);
await drafts.delete(retained.id);
assert.equal(await drafts.get(retained.id), null);

console.log("draft publication smoke: OK");
