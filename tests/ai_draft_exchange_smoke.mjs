import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assembleOwnerAiDraftTextParts,
  extractOwnerAiDraftResponseText,
  extractOwnerAiDraftTextPart,
  isOwnerAiDraftDocument,
  TelegramRuntime
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
assert.match(emptyListRequest.task.responseContract.join("\n"), /item's blocks array/,
  "an empty list request must explain the otherwise invisible list-item schema");
assert.doesNotMatch(emptyListRequest.task.responseContract.join("\n"), /\{\"blocks\"/,
  "schema guidance must not embed quote-sensitive JSON inside a JSON string");

const documentPromptRequest = buildAiDraftRequest({
  messageAst: ast,
  target: { kind: "draft", draftId: "draft-1", version: 7, includeFullContext: true },
  scope: { kind: "message" },
  documentPrompt: "Fill the list and use its five items in the following five paragraphs."
});
assert.equal(documentPromptRequest.task.documentPrompt,
  "Fill the list and use its five items in the following five paragraphs.");
assert.match(documentPromptRequest.task.instruction, /task\.documentPrompt across every block it explicitly addresses/);
assert.match(documentPromptRequest.task.responseContract.at(-1), /coordinate changes across multiple explicitly referenced blocks/);

const isolatedBlockRequest = buildAiDraftRequest({
  messageAst: ast,
  scope: { kind: "block", nodeId: "heading-1" },
  documentPrompt: "This must not leak into a block request."
});
assert.equal(isolatedBlockRequest.task.documentPrompt, undefined,
  "a whole-document prompt must never leak into Block AI JSON");

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
const fencedTelegramText = `\`\`\`json\n${telegramText}\n\`\`\``;
assert.equal(extractOwnerAiDraftResponseText({ text: fencedTelegramText }), fencedTelegramText);
assert.equal(extractOwnerAiDraftResponseText({ text: "ordinary message" }), "");
assert.deepEqual(extractOwnerAiDraftTextPart({ text: "AI JSON 1/2\n```json\n{\"format\":" }), {
  batchId: "default",
  index: 1,
  total: 2,
  text: "```json\n{\"format\":"
});
assert.deepEqual(extractOwnerAiDraftTextPart({ text: "AI JSON post42 2/3\nsecond part" }), {
  batchId: "post42",
  index: 2,
  total: 3,
  text: "second part"
});
assert.equal(extractOwnerAiDraftTextPart({ text: "AI JSON 4/3\ninvalid" }), null);
const telegramSplitAt = Math.floor(fencedTelegramText.length / 2);
assert.equal(assembleOwnerAiDraftTextParts([
  fencedTelegramText.slice(0, telegramSplitAt),
  fencedTelegramText.slice(telegramSplitAt)
]), fencedTelegramText, "a code block may span multiple Telegram text messages");
const rawTelegramSplitAt = Math.floor(telegramText.length / 2);
assert.equal(assembleOwnerAiDraftTextParts([
  `\`\`\`json\n${telegramText.slice(0, rawTelegramSplitAt)}\n\`\`\``,
  `\`\`\`json\n${telegramText.slice(rawTelegramSplitAt)}\n\`\`\``
]), telegramText, "individually fenced chunks are accepted too");

const multipartRuntimeRows = new Map();
const multipartEvents = [];
let multipartPoll = 0;
const multipartRuntime = new TelegramRuntime({
  db: {
    async get(store, key, fallback = null) {
      return multipartRuntimeRows.has(`${store}:${key}`) ? multipartRuntimeRows.get(`${store}:${key}`) : fallback;
    },
    async put(store, key, value) { multipartRuntimeRows.set(`${store}:${key}`, structuredClone(value)); },
    async delete(store, key) { multipartRuntimeRows.delete(`${store}:${key}`); }
  },
  events: {
    emit() {},
    async emitAsync(name, payload) { multipartEvents.push({ name, payload }); }
  },
  client: {
    async getMe() { return { id: 7, username: "test_bot" }; },
    async getWebhookInfo() { return {}; },
    async getUpdates(_params, { signal }) {
      if (multipartPoll++ === 0) {
        return [
          {
            update_id: 1,
            message: {
              message_id: 201,
              from: { id: 42 },
              chat: { id: 42, type: "private" },
              text: `AI JSON sample 1/2\n${fencedTelegramText.slice(0, telegramSplitAt)}`
            }
          },
          {
            update_id: 2,
            message: {
              message_id: 202,
              from: { id: 42 },
              chat: { id: 42, type: "private" },
              reply_to_message: { message_id: 101 },
              text: `AI JSON sample 2/2\n${fencedTelegramText.slice(telegramSplitAt)}`
            }
          }
        ];
      }
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true }));
    }
  },
  ownerBinding: { async getOwner() { return { userId: 42, chatId: 42 }; } },
  previewChannelBinding: {}
});
await multipartRuntime.start();
for (let attempt = 0; attempt < 20 && !multipartEvents.some(event => event.name === "telegram:ai-draft-response"); attempt += 1) {
  await new Promise(resolve => setImmediate(resolve));
}
await multipartRuntime.stop();
const multipartResponse = multipartEvents.find(event => event.name === "telegram:ai-draft-response")?.payload;
assert.equal(multipartResponse?.text, fencedTelegramText, "Telegram runtime assembles a persisted multipart text response");
assert.deepEqual(multipartResponse?.source?.messageIds, [201, 202]);
assert.equal(multipartResponse?.source?.replyToMessageId, 101);
assert.equal([...multipartRuntimeRows.keys()].some(key => key.includes("ai.text-parts")), false,
  "the completed multipart buffer is removed from local runtime storage");
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
let clipboardText = "";
const clipboardListeners = new Map();
const clipboardInput = {
  value: "",
  focused: false,
  selected: false,
  addEventListener(name, handler) { clipboardListeners.set(name, handler); },
  removeEventListener(name) { clipboardListeners.delete(name); },
  focus() { this.focused = true; },
  select() { this.selected = true; },
  paste(text) {
    clipboardListeners.get("paste")?.({
      clipboardData: { getData: type => type === "text/plain" ? text : "" },
      preventDefault() {}
    });
  }
};
const clipboardApi = { async readText() { return clipboardText; } };
const invalidClipboardReports = [];
const exchangeNotices = [];
const deletedMessages = [];
const conflictPrompts = [];
const createdDrafts = [];
let conflictChoice = null;
const missingRequest = Object.assign(new Error("message to delete not found"), { isMessageMissing: () => true });
const activeDraft = {
  id: "draft-1",
  title: "Companies",
  messageAst: storedAst,
  updatedAt: 7,
  ai: { includeFullContext: true, documentPrompt: "Coordinate every prompted block." }
};
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
  input: clipboardInput,
  clipboard: clipboardApi,
  invalidResponseReporter(options) { invalidClipboardReports.push(options); },
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
  notifications: { show(payload) { exchangeNotices.push(payload); } }
});
exchange.start();
exchange.clipboard = { async readText() { throw new DOMException("Denied", "NotAllowedError"); } };
assert.equal(await exchange.pasteAndImport(), null);
assert.equal(clipboardInput.focused, true);
assert.equal(clipboardInput.selected, true);
assert.equal(exchangeNotices.at(-1).type, "warning");
clipboardInput.paste("{invalid fallback json");
await new Promise(resolve => setImmediate(resolve));
assert.equal(invalidClipboardReports.length, 1,
  "a user-initiated paste event must reach the same validator after Clipboard API denial");
exchange.clipboard = clipboardApi;
assert.equal(exchange.openBot(), true);
assert.equal(botOpenCalls, 1);
await exchange.open();
const wholeDraftPayload = JSON.parse(clipboardInput.value);
assert.equal(wholeDraftPayload.task.documentPrompt, "Coordinate every prompted block.");
assert.equal(wholeDraftPayload.messageAst.children.length, 2,
  "right-panel document AI includes the entire draft context");
await exchange.open({ nodeId: "heading-1" });
const clipboardPayload = JSON.parse(clipboardInput.value);
assert.equal(clipboardPayload.task.documentPrompt, undefined,
  "opening AI JSON from a Canvas block must ignore the right-panel document prompt");
clipboardPayload.messageAst.children[0].props.text = "Clipboard title";
clipboardText = "{invalid clipboard json";
assert.equal(await exchange.pasteAndImport(), null);
assert.equal(invalidClipboardReports.length, 2);
assert.match(invalidClipboardReports.at(-1).message, /некорректный JSON|invalid JSON/i);
assert.equal(clipboardInput.value, clipboardText, "invalid clipboard contents remain visible for inspection");

clipboardText = JSON.stringify(clipboardPayload);
const clipboardImported = await exchange.pasteAndImport();
assert.ok(clipboardImported);
assert.equal(storedAst.children[0].props.text, "Clipboard title");
assert.equal(clipboardInput.value, clipboardText);

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
  telegramSource: { chatId: 42, messageId: 104, messageIds: [102, 103, 104], replyToMessageId: 101 }
});
assert.ok(imported, "a missing request message must not fail a valid import");
assert.equal(storedAst.children[0].props.text, "Imported title");
assert.deepEqual(deletedMessages, [[42, 102], [42, 103], [42, 104], [42, 101]],
  "every multipart response message and the request are cleaned up after import");

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
clipboardText = JSON.stringify(sentPayload);
const cancelledConflict = await exchange.pasteAndImport();
assert.equal(cancelledConflict, null);
assert.equal(storedAst.children[0].props.text, "Imported title", "closing the conflict dialog changes nothing");
assert.equal(createdDrafts.length, 0, "a version conflict must not create a draft without an explicit choice");
assert.equal(conflictPrompts.length, 1);
assert.equal(runtimeRows.has(sentRequestKey), true,
  "cancelling keeps the pending exchange available for another import attempt");

conflictChoice = "apply-current";
await exchange.pasteAndImport();
assert.equal(storedAst.children[0].props.text, "Conflicting title", "the current block changes only after confirmation");
assert.equal(runtimeRows.has(sentRequestKey), false, "a completed conflict choice cleans up the exchange");

conflictChoice = "new-draft";
sentPayload.messageAst.children[0].props.text = "Forked title";
clipboardText = JSON.stringify(sentPayload);
await exchange.pasteAndImport();
assert.equal(createdDrafts.length, 1, "a conflict fork is created only after that explicit choice");
assert.equal(createdDrafts[0].messageAst.children[0].props.text, "Forked title");
assert.equal(createdDrafts[0].source.importedVia, "clipboard");

const [html, editorCss, shellSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles/editor.css", import.meta.url), "utf8"),
  readFile(new URL("../js/app/createEditorShell.js", import.meta.url), "utf8")
]);
assert.match(html, /id="aiDraftPaste"/);
assert.match(html, /id="aiDraftImport"[\s\S]*?id="aiDraftSend"[\s\S]*?id="aiDraftOpenBot"/,
  "bot actions must form the final right-side group");
assert.match(editorCss, /\.button-like \{[\s\S]*?font-size: 9px;/,
  "the response file label must use the same compact font size as dialog buttons");
assert.match(editorCss, /#aiDraftSend \{ margin-left: auto; \}/,
  "the Send to bot button must push both bot actions to the right");
assert.match(shellSource, /pasteButton: query\("#aiDraftPaste"\)/);

console.log("ai draft exchange smoke: ok");
