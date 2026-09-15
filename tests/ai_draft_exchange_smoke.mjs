import assert from "node:assert/strict";
import {
  AI_DRAFT_FORMAT,
  AiDraftExchange,
  applyScopedAiResponse,
  buildAiDraftRequest,
  mergeMissingAiPrompts,
  parseAiDraftResponse
} from "../js/editor/AiDraftExchange.js";
import { astHasAiPrompt } from "../js/editor/DraftListView.js";
import {
  extractOwnerAiDraftResponseText,
  isOwnerAiDraftDocument
} from "../js/telegram/TelegramRuntime.js";

const ast = {
  id: "root",
  type: "document",
  props: {},
  children: [
    {
      id: "heading-1",
      type: "heading",
      props: { text: "Old title", level: 1 },
      ai: { prompt: "Write a clearer title", field: "text" },
      children: []
    },
    {
      id: "list-1",
      type: "list",
      props: { items: [{ text: "Company A" }], style: "bullet" },
      children: []
    }
  ]
};

const request = buildAiDraftRequest({
  messageAst: ast,
  target: { kind: "draft", draftId: "draft-1", version: 7 },
  scope: { kind: "field", nodeId: "heading-1", field: "text" },
  contextIncluded: "message",
  requestId: "request-1",
  createdAt: 0
});

assert.equal(request.format, AI_DRAFT_FORMAT);
assert.equal(request.request.scope.kind, "field");
assert.equal(request.request.contextIncluded, "message");
assert.equal(request.messageAst.children.length, 2, "extended context keeps the entire draft");
assert.match(request.task.responseContract.at(-1), /props\.text/);

const privateIdsRequest = buildAiDraftRequest({
  messageAst: {
    ...ast,
    props: { chatId: -100123, channel_id: -100456, message_id: 55, harmless: "kept" }
  },
  target: { kind: "draft", draftId: "draft-1", version: 7, chatId: -100123, channelId: -100456, messageId: 55 }
});
assert.equal(privateIdsRequest.request.target.chatId, undefined);
assert.equal(privateIdsRequest.request.target.channelId, undefined);
assert.equal(privateIdsRequest.request.target.messageId, undefined);
assert.deepEqual(privateIdsRequest.messageAst.props, { harmless: "kept" });
assert.doesNotMatch(JSON.stringify(privateIdsRequest), /(?:chat|channel|message)_?id/i);
assert.equal(astHasAiPrompt(ast), true);
assert.equal(astHasAiPrompt({ ...ast, children: [ast.children[1]] }), false);
assert.throws(
  () => parseAiDraftResponse({ ...request, request: { ...request.request, id: "" } }),
  /request\.id/
);

const parsed = parseAiDraftResponse(`\`\`\`json\n${JSON.stringify(request)}\n\`\`\``);
assert.equal(parsed.request.id, "request-1");
assert.equal(parsed.messageAst.children[0].ai.field, "text");

const response = structuredClone(request.messageAst);
response.children[0].props.text = "New title";
response.children[0].props.level = 3;
response.children[1].props.items = [{ text: "Should not be imported" }];
const fieldPatched = applyScopedAiResponse(ast, response, request.request.scope);
assert.equal(fieldPatched.children[0].props.text, "New title");
assert.equal(fieldPatched.children[0].props.level, 1, "field scope rejects sibling property changes");
assert.equal(fieldPatched.children[1].props.items[0].text, "Company A", "field scope rejects other block changes");
const responseWithoutTargetField = structuredClone(response);
delete responseWithoutTargetField.children[0].props.text;
assert.throws(
  () => applyScopedAiResponse(ast, responseWithoutTargetField, request.request.scope),
  /props\.text/
);

const missingPrompt = structuredClone(ast);
delete missingPrompt.children[0].ai;
const restored = mergeMissingAiPrompts(missingPrompt, ast);
assert.deepEqual(restored.children[0].ai, ast.children[0].ai, "prompt and selected field survive a model omission");

const telegramText = JSON.stringify(request);
assert.equal(extractOwnerAiDraftResponseText({ text: telegramText }), telegramText);
assert.equal(extractOwnerAiDraftResponseText({ text: "ordinary message" }), "");
assert.equal(isOwnerAiDraftDocument({ document: { file_name: "draft-ai-response.json" } }), true);
assert.equal(isOwnerAiDraftDocument({ document: { file_name: "notes.json" } }), false);

const runtimeRows = new Map();
const db = {
  async get(store, key, fallback = null) { return runtimeRows.has(`${store}:${key}`) ? runtimeRows.get(`${store}:${key}`) : fallback; },
  async put(store, key, value) { runtimeRows.set(`${store}:${key}`, structuredClone(value)); },
  async delete(store, key) { runtimeRows.delete(`${store}:${key}`); }
};
let storedAst = structuredClone(ast);
let capturedFile = null;
const deletedMessages = [];
const missingRequest = Object.assign(new Error("message to delete not found"), { isMessageMissing: () => true });
const activeDraft = { id: "draft-1", title: "Companies", messageAst: storedAst, updatedAt: 7, ai: { includeFullContext: true } };
const draftSession = {
  activeDraftId: activeDraft.id,
  isActive: () => true,
  activate(draft) { this.activeDraftId = draft.id; }
};
const drafts = {
  async get(id) { return id === activeDraft.id ? { ...activeDraft, messageAst: structuredClone(storedAst) } : null; },
  async saveAst(id, nextAst) { storedAst = structuredClone(nextAst); return { ...activeDraft, id, messageAst: storedAst, updatedAt: 8 }; }
};
const exchange = new AiDraftExchange({
  db,
  tree: { root: storedAst, toJSON: () => structuredClone(storedAst) },
  draftSession,
  drafts,
  documents: { async saveCurrentContext() {} },
  ownerBinding: { async getOwner() { return { chatId: 42 }; } },
  client: {
    async uploadDocument({ file }) { capturedFile = file; return { message_id: 101 }; },
    async deleteMessage(chatId, messageId) {
      deletedMessages.push([chatId, messageId]);
      if (messageId === 101) throw missingRequest;
    }
  },
  notifications: { show() {} }
});
await exchange.open({ nodeId: "heading-1" });
await exchange.sendToBot();
const sentPayload = JSON.parse(await capturedFile.text());
assert.equal(sentPayload.request.scope.kind, "field");
sentPayload.messageAst.children[0].props.text = "Imported title";
const imported = await exchange.importText(JSON.stringify(sentPayload), {
  viaTelegram: true,
  telegramSource: { chatId: 42, messageId: 102, replyToMessageId: 101 }
});
assert.ok(imported, "a missing request message must not fail a valid import");
assert.equal(storedAst.children[0].props.text, "Imported title");
assert.deepEqual(deletedMessages, [[42, 102], [42, 101]], "response and request cleanup is attempted after import");

console.log("ai draft exchange smoke: ok");
