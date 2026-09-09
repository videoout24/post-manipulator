import assert from "node:assert/strict";
import { TelegramApiError } from "../js/telegram/TelegramClient.js?v=1.8.6";
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

function fixture({ localOnly = false, assets = [{ id: "asset", topicThreadId: 9 }], used = false, remoteError = null, localError = null, alreadyMissing = false } = {}) {
  const calls = [];
  let topic = { threadId: 9, name: "Media", telegramDeleted: localOnly };
  let indexes = structuredClone(assets);
  const core = new GalleryCore({
    telegramCore: { topics: { async delete(id) {
      calls.push(["remote", id]);
      if (remoteError) throw remoteError;
      return { alreadyMissing };
    } } },
    store: {
      async getTopic() { return topic; },
      async list({ threadId }) { return indexes.filter(asset => asset.topicThreadId === threadId); },
      async markTopicDeleted() { calls.push(["retain"]); topic = { ...topic, telegramDeleted: true }; return topic; },
      async removeTopicAndAssets(id, selected) {
        calls.push(["local", id, selected.map(asset => asset.id)]);
        if (localError) throw localError;
        indexes = indexes.filter(asset => !selected.some(item => item.id === asset.id));
        topic = null;
      }
    },
    thumbnails: { async remove(id) { calls.push(["thumb", id]); } },
    tree: { toJSON() { return { props: {}, children: used ? [{ props: { galleryId: "asset" }, children: [] }] : [] }; } }
  });
  return { core, calls, get topic() { return topic; }, get assets() { return indexes; } };
}

const botOnly = { deleteFromBot: true };
const editorOnly = { deleteFromEditor: true };
const both = { deleteFromBot: true, deleteFromEditor: true };

for (const alreadyMissing of [false, true]) {
  const f = fixture({ alreadyMissing });
  const result = await f.core.deleteTopic(9, botOnly);
  assert.equal(result.retained, true);
  assert.equal(result.alreadyMissing, alreadyMissing);
  assert.equal(f.topic.telegramDeleted, true);
  assert.equal(f.assets.length, 1);
  assert.deepEqual(f.calls, [["remote", 9], ["retain"]]);
}
for (const localOnly of [false, true]) {
  const f = fixture({ localOnly });
  const result = await f.core.deleteTopic(9, editorOnly);
  assert.equal(result.retained, false);
  assert.equal(result.deletedFromBot, false);
  assert.equal(f.topic, null);
  assert.deepEqual(f.assets, []);
  assert.deepEqual(f.calls, [["local", 9, ["asset"]], ["thumb", "asset"]]);
}
for (const assets of [[], [{ id: "asset", topicThreadId: 9 }]]) {
  const f = fixture({ assets });
  const result = await f.core.deleteTopic(9, both);
  assert.equal(result.deletedFromBot, true);
  assert.equal(result.deletedFromEditor, true);
  assert.equal(f.topic, null);
  assert.deepEqual(f.assets, []);
}
for (const scope of [editorOnly, both]) {
  const f = fixture({ used: true, assets: [{ id: "unused", topicThreadId: 9 }, { id: "asset", topicThreadId: 9 }] });
  await assert.rejects(f.core.deleteTopic(9, scope), error => error.name === "GalleryAssetInUseError" && error.assetId === "asset");
  assert.deepEqual(f.calls, [], "usage checks must finish before either deletion starts");
  assert.equal(f.assets.length, 2);
}
{
  const f = fixture({ used: true });
  await f.core.deleteTopic(9, botOnly);
  assert.equal(f.assets.length, 1, "remote-only removal keeps indexes used by posts");
}
{
  const f = fixture({ remoteError: new Error("offline") });
  await assert.rejects(f.core.deleteTopic(9, both), /offline/);
  assert.deepEqual(f.calls, [["remote", 9]]);
  assert.equal(f.topic.telegramDeleted, false);
  assert.equal(f.assets.length, 1);
}
{
  const f = fixture({ localError: new Error("storage failure") });
  await assert.rejects(f.core.deleteTopic(9, both), /storage failure/);
  assert.equal(f.topic.telegramDeleted, true, "a local failure must not hide successful remote deletion");
  assert.equal(f.assets.length, 1);
  assert.equal(f.calls.some(call => call[0] === "thumb"), false);
}
{
  const f = fixture();
  for (const id of [0, -1, NaN, Infinity, 1.5, "bad"]) await assert.rejects(f.core.deleteTopic(id, both));
  await assert.rejects(f.core.deleteTopic(9));
  assert.deepEqual(f.calls, [], "no scope or invalid ID must never delete anything");
}
{
  const f = fixture({ localOnly: true });
  await assert.rejects(f.core.deleteTopic(9, botOnly));
  assert.deepEqual(f.calls, [], "local folders cannot trigger a remote deletion");
  await f.core.deleteTopic(9, both);
  assert.equal(f.calls.some(call => call[0] === "remote"), false);
}
console.log("gallery_topic_lifecycle_smoke: OK");
