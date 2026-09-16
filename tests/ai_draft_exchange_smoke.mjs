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
      props: { items: [{ blocks: [{ type: "paragraph", text: "Company A" }] }], style: "bullet" },
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

const emptyListRequest = buildAiDraftRequest({
  messageAst: {
    id: "root", type: "document", props: {}, children: [
      { id: "list-empty", type: "list", props: { items: [] }, children: [], ai: { prompt: "Fill the list" } }
    ]
  },
  target: { kind: "draft", draftId: "draft-list", version: 1 },
  scope: { kind: "block", nodeId: "list-empty" }
});
assert.match(emptyListRequest.task.responseContract.join("\n"), /item\.blocks/,
  "an empty list request must explain the otherwise invisible list-item schema");

const stringListResponse = structuredClone(emptyListRequest);
stringListResponse.messageAst.children[0].props.items = ["First", { text: "Second" }];
const parsedStringList = parseAiDraftResponse(stringListResponse);
assert.deepEqual(parsedStringList.messageAst.children[0].props.items, [
  { blocks: [{ type: "paragraph", text: "First" }] },
  { blocks: [{ type: "paragraph", text: "Second" }] }
], "common model list shortcuts are normalized before the editor renders them");

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
response.children[1].props.items = [{ blocks: [{ type: "paragraph", text: "Should not be imported" }] }];
const fieldPatched = applyScopedAiResponse(ast, response, request.request.scope);
assert.equal(fieldPatched.children[0].props.text, "New title");
assert.equal(fieldPatched.children[0].props.level, 1, "field scope rejects sibling property changes");
assert.equal(fieldPatched.children[1].props.items[0].blocks[0].text, "Company A", "field scope rejects other block changes");
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
assert.equal(isOwnerAiDraftDocument({ document: { file_name: "answer.json" } }), true,
  "a typical downloaded model answer must not be routed to Gallery as a generic document");
assert.equal(isOwnerAiDraftDocument({ document: { file_name: "notes.json" } }), false);

const runtimeRows = new Map();
const db = {
  async get(store, key, fallback = null) { return runtimeRows.has(`${store}:${key}`) ? runtimeRows.get(`${store}:${key}`) : fallback; },
  async put(store, key, value) { runtimeRows.set(`${store}:${key}`, structuredClone(value)); },
  async delete(store, key) { runtimeRows.delete(`${store}:${key}`); }
};
let storedAst = structuredClone(ast);
let capturedFile = null;
let botOpenCalls = 0;
const deletedMessages = [];
const conflictPrompts = [];
const createdDrafts = [];
let conflictChoice = null;
const missingRequest = Object.assign(new Error("message to delete not found"), { isMessageMissing: () => true });
const activeDraft = { id: "draft-1", title: "Companies", messageAst: storedAst, updatedAt: 7, ai: { includeFullContext: true } };
const draftSession = {
  activeDraftId: activeDraft.id,
  isActive: () => true,
  activate(draft) { this.activeDraftId = draft.id; }
};
const drafts = {
  async get(id) { return id === activeDraft.id ? { ...activeDraft, messageAst: structuredClone(storedAst) } : null; },
  async saveAst(id, nextAst) { storedAst = structuredClone(nextAst); return { ...activeDraft, id, messageAst: storedAst, updatedAt: 8 }; },
  async create(input) {
    const created = { ...structuredClone(input), id: `fork-${createdDrafts.length + 1}` };
    createdDrafts.push(created);
    return created;
  }
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
  navigation: { openBot() { botOpenCalls += 1; return true; } },
  conflictResolver(options) { conflictPrompts.push(options); return conflictChoice; },
  notifications: { show() {} }
});
assert.equal(exchange.openBot(), true);
assert.equal(botOpenCalls, 1);
await exchange.open({ nodeId: "heading-1" });
await exchange.sendToBot();
const sentPayload = JSON.parse(await capturedFile.text());
assert.equal(sentPayload.request.scope.kind, "field");
assert.equal(sentPayload.request.contextIncluded, "block");
assert.equal(sentPayload.messageAst.children.length, 1,
  "Block AI JSON must stay isolated even when the card's full-context checkbox is enabled");
sentPayload.messageAst.children[0].props.text = "Imported title";
const imported = await exchange.importText(JSON.stringify(sentPayload), {
  viaTelegram: true,
  telegramSource: { chatId: 42, messageId: 102, replyToMessageId: 101 }
});
assert.ok(imported, "a missing request message must not fail a valid import");
assert.equal(storedAst.children[0].props.text, "Imported title");
assert.deepEqual(deletedMessages, [[42, 102], [42, 101]], "response and request cleanup is attempted after import");

activeDraft.updatedAt = 9;
sentPayload.messageAst.children[0].props.text = "Conflicting title";
const sentRequestKey = `runtime:ai.request:${sentPayload.request.id}`;
runtimeRows.set(sentRequestKey, {
  requestId: sentPayload.request.id,
  target: structuredClone(sentPayload.request.target),
  scope: structuredClone(sentPayload.request.scope),
  contextIncluded: "block",
  createdAt: Date.now()
});
conflictChoice = null;
const cancelledConflict = await exchange.importText(JSON.stringify(sentPayload));
assert.equal(cancelledConflict, null);
assert.equal(storedAst.children[0].props.text, "Imported title", "closing the conflict dialog changes nothing");
assert.equal(createdDrafts.length, 0, "a version conflict must not create a draft without an explicit choice");
assert.equal(conflictPrompts.length, 1);
assert.equal(runtimeRows.has(sentRequestKey), true,
  "cancelling keeps the pending exchange available for another import attempt");

conflictChoice = "apply-current";
await exchange.importText(JSON.stringify(sentPayload));
assert.equal(storedAst.children[0].props.text, "Conflicting title", "the current block changes only after confirmation");
assert.equal(runtimeRows.has(sentRequestKey), false, "a completed conflict choice cleans up the exchange");

conflictChoice = "new-draft";
sentPayload.messageAst.children[0].props.text = "Forked title";
await exchange.importText(JSON.stringify(sentPayload));
assert.equal(createdDrafts.length, 1, "a conflict fork is created only after that explicit choice");
assert.equal(createdDrafts[0].messageAst.children[0].props.text, "Forked title");

console.log("ai draft exchange smoke: ok");
