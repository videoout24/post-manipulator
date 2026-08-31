import assert from "node:assert/strict";
import { TelegramApiError } from "../js/telegram/TelegramClient.js?v=1.5.9";
import { TopicTransport } from "../js/telegram/TopicTransport.js?v=1.5.9";
import { GalleryCore } from "../js/gallery/GalleryCore.js?v=1.5.9";

const missing = new TelegramApiError("topic not found", {
  method: "editForumTopic",
  errorCode: 400,
  description: "Bad Request: message thread not found"
});
const transport = new TopicTransport({
  ownerBinding: { async getOwner() { return { chatId: 123 }; } },
  client: {
    async editForumTopic() { throw missing; },
    async deleteForumTopic() { throw missing; }
  }
});
assert.equal(await transport.rename(9, "Renamed"), null, "missing topic rename must be a silent no-op");
assert.equal((await transport.delete(9)).deleted, true, "missing topic delete is already complete");

const invalidTopicId = new TelegramApiError("Bad Request: TOPIC_ID_INVALID", {
  method: "deleteForumTopic",
  errorCode: 400,
  description: "Bad Request: TOPIC_ID_INVALID"
});
const invalidTopicTransport = new TopicTransport({
  ownerBinding: { async getOwner() { return { chatId: 123 }; } },
  client: { async deleteForumTopic() { throw invalidTopicId; } }
});
assert.equal(
  (await invalidTopicTransport.delete(10)).alreadyMissing,
  true,
  "TOPIC_ID_INVALID means the remote topic is already absent"
);

const calls = [];
let assets = [{ id: "asset", topicThreadId: 9 }];
const core = new GalleryCore({
  db: {},
  telegramCore: {
    topics: {
      async delete(threadId) { calls.push(["telegram:delete", threadId]); },
      onObserved: () => () => {}
    },
    media: { onReceived: () => () => {} }
  },
  client: {},
  store: {
    async list({ threadId }) { return assets.filter(asset => asset.topicThreadId === threadId); },
    async markTopicDeleted(threadId) { calls.push(["local:retain", threadId]); return { threadId, telegramDeleted: true }; },
    async removeTopic(threadId) { calls.push(["local:remove", threadId]); }
  },
  thumbnails: {}
});
let result = await core.deleteTopic(9);
assert.equal(result.retained, true);
assert.deepEqual(calls, [["telegram:delete", 9], ["local:retain", 9]]);

calls.length = 0;
assets = [];
result = await core.deleteTopic(9);
assert.equal(result.retained, false);
assert.deepEqual(calls, [["telegram:delete", 9], ["local:remove", 9]]);

calls.length = 0;
assets = [{ id: "asset", topicThreadId: 9 }];
core.telegramCore.topics.delete = async threadId => {
  calls.push(["telegram:delete", threadId]);
  return { threadId, deleted: true, alreadyMissing: true };
};
result = await core.deleteTopic(9);
assert.equal(result.retained, true);
assert.equal(result.alreadyMissing, true);
assert.deepEqual(
  calls,
  [["telegram:delete", 9], ["local:retain", 9]],
  "a remotely missing topic must remain as a local folder while assets reference it"
);

calls.length = 0;
assets = [];
result = await core.deleteTopic(9);
assert.equal(result.retained, false);
assert.equal(result.alreadyMissing, true);
assert.deepEqual(
  calls,
  [["telegram:delete", 9], ["local:remove", 9]],
  "a remotely missing empty topic must be removed from the editor"
);

console.log("gallery_topic_lifecycle_smoke: OK");
