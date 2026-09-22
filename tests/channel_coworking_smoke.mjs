import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { DraftStore } from "../js/editor/DraftStore.js";
import { PublicationTargetService } from "../js/telegram/PublicationTargetService.js";
import { PublicationService } from "../js/telegram/PublicationService.js";
import { ChannelCollaborationService } from "../js/telegram/ChannelCollaborationService.js";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  s(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { return structuredClone(this.s(store).get(key) ?? fallback); }
  async put(store, key, value) { this.s(store).set(key, structuredClone(value)); return value; }
  async delete(store, key) { this.s(store).delete(key); }
  async all(store) { return [...this.s(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}

const db = new MemoryDb();
const events = new EventBus();
const selectedBot = {
  id: 20, username: "cowork_bot", firstName: "Cowork", lastName: "Bot", status: "administrator",
  rights: { post: true, edit: true, delete: true }
};
const target = {
  chatId: -100123,
  type: "channel",
  telegramType: "channel",
  title: "Private studio",
  username: "",
  visibility: "private",
  status: "ready",
  collaboration: { enabled: true, selectedBotIds: [20], bots: [selectedBot] }
};

const adminClient = {
  async getMe() { return { id: 10, is_bot: true, username: "local_bot" }; },
  async getChatAdministrators() {
    return [
      { status: "administrator", can_post_messages: true, user: { id: 10, is_bot: true, username: "local_bot" } },
      { status: "administrator", can_post_messages: true, can_edit_messages: true, can_delete_messages: true, user: { id: 20, is_bot: true, username: "cowork_bot", first_name: "Cowork", last_name: "Bot" } },
      { status: "creator", user: { id: 30, is_bot: false, first_name: "Owner" } }
    ];
  }
};
await db.put("bindings", "publicationTargets", [{ ...target, collaboration: null }]);
const targetService = new PublicationTargetService({
  db,
  client: adminClient,
  previewChannelBinding: { async getSlot() { return null; }, async getSession() { return null; } }
});
const inspection = await targetService.inspectCollaboratorBots(target.chatId);
assert.deepEqual(inspection.bots.map(bot => bot.id), [20], "only other admin bots are offered");
const configured = await targetService.setCollaboratorBots(target.chatId, [20, 30]);
assert.equal(configured.collaboration.enabled, true);
assert.deepEqual(configured.collaboration.selectedBotIds, [20]);

const drafts = new DraftStore({ db, events });
let restoredMessageId = 500;
const telegramClient = {
  async editRichMessage() { throw { isMessageMissing: () => true }; },
  async sendRichMessage() { return { message_id: restoredMessageId, date: 2_000 }; }
};
const publications = new PublicationService({
  db,
  events,
  client: telegramClient,
  renderer: { renderEnvelope(tree) { return { richMessage: { blocks: tree.root.children }, replyMarkup: { inline_keyboard: [] } }; } },
  validator: { validate() { return []; } },
  targets: { async list() { return [configured]; } },
  drafts
});
const collaboration = new ChannelCollaborationService({
  events,
  publicationTargets: { async list() { return [configured]; } },
  publications
});
const mediaEvents = [];
events.on("telegram:collaboration-media", media => mediaEvents.push(media));
const marker = "#comessage_abcdef123456";
const initialUpdate = {
  channel_post: {
    message_id: 40,
    date: 1_000,
    chat: { id: target.chatId, type: "channel", title: target.title },
    from: { id: 20, is_bot: true, username: "cowork_bot" },
    rich_message: { blocks: [
      { type: "paragraph", text: { type: "hashtag", text: marker, hashtag: marker } },
      { type: "paragraph", text: "Remote initial" },
      { type: "photo", photo: [{ file_id: "photo-small", file_unique_id: "unique-small", width: 90, height: 90 }, { file_id: "photo-large", file_unique_id: "unique-large", width: 900, height: 900 }] }
    ] }
  }
};
assert.equal(await collaboration.handleUpdate(initialUpdate), true);
let records = await publications.list();
assert.equal(records.length, 1);
assert.equal(records[0].collaboration.id, marker);
assert.equal(mediaEvents.length, 1, "Rich Message media is emitted as an individual Gallery event");
assert.equal(mediaEvents[0].fileId, "photo-large");
const stableMediaKey = mediaEvents[0].sourceEventKey;

const draftId = records[0].source.draftId;
const localDraft = await drafts.get(draftId);
localDraft.messageAst.children[1].props.text = "My independent version";
await drafts.saveAst(draftId, localDraft.messageAst);

const editedUpdate = structuredClone(initialUpdate);
editedUpdate.edited_channel_post = editedUpdate.channel_post;
delete editedUpdate.channel_post;
editedUpdate.edited_channel_post.rich_message.blocks[1].text = "Another bot version";
await collaboration.handleUpdate(editedUpdate);
assert.equal((await drafts.get(draftId)).messageAst.children[1].props.text, "My independent version",
  "incoming edits never overwrite the local working copy");
assert.equal(mediaEvents.length, 1, "edited posts do not re-index initial Rich Message media");

const restoredUpdate = structuredClone(initialUpdate);
restoredUpdate.channel_post.message_id = 41;
await collaboration.handleUpdate(restoredUpdate);
records = await publications.list();
assert.equal(records[0].messageId, 41, "the stable marker relinks a restored Telegram message");
assert.equal((await drafts.get(draftId)).source.messageId, 41);
assert.equal(mediaEvents.at(-1).sourceEventKey, stableMediaKey, "restores reuse stable per-block media keys");

await assert.rejects(
  () => publications.applyDraftChanges(draftId),
  error => error.code === "COLLABORATIVE_PUBLICATION_MISSING"
);
const restored = await publications.restoreCollaborativePublication(draftId);
assert.equal(restored.messageId, restoredMessageId);
assert.equal(restored.collaboration.id, marker);
assert.equal((await drafts.get(draftId)).source.messageId, restoredMessageId);

const ignored = structuredClone(initialUpdate);
ignored.channel_post.from.id = 999;
assert.equal(await collaboration.handleUpdate(ignored), false, "updates from unselected bots are ignored");

console.log("channel coworking smoke: OK");
