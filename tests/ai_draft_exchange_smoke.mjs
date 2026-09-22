import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_DRAFT_FORMAT,
  AiDraftExchange,
  applyMessageAiResponse,
  applyScopedAiResponse,
  buildAiDraftRequest,
  mergeMissingAiPrompts,
  parseAiDraftResponse
} from "../js/editor/AiDraftExchange.js";
import { astHasAiPrompt } from "../js/editor/DraftListView.js";
import { isJsonDocument } from "../js/telegram/TelegramRuntime.js";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js";
import { BlockRegistry } from "../js/core/BlockRegistry.js";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);

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
  registry,
  requestId: "request-1",
  createdAt: 0
});

assert.equal(request.format, AI_DRAFT_FORMAT);
assert.equal(request.request.scope.kind, "field");
assert.equal(request.request.contextIncluded, "message");
assert.equal(request.messageAst.children.length, 2, "extended context keeps the entire draft");
assert.match(request.task.responseContract.at(-1), /props\.text/);
assert.deepEqual(request.task.formatSets.f1.simpleFormats,
  ["bold", "italic", "underline", "strikethrough", "spoiler", "subscript", "superscript", "marked", "code"]);
assert.deepEqual(request.task.formatSets.f1.simpleTemplate,
  { type: "<one simpleFormats value>", text: "string" });
assert.deepEqual(request.task.formatSets.f1.specialFormats.url,
  { type: "url", text: "string", url: "string" }, "URL formatting must expose its three-key object shape");
assert.deepEqual(request.task.formatSets.f1.specialFormats.date_time, {
  type: "date_time", text: "string", unix_time: "integer", date_time_format: "string"
});
assert.equal(request.task.richTextSchema.appliesTo, "changed rich-text properties");
assert.equal(request.task.richTextSchema.whenFormatNotRequested, "string");
assert.match(request.task.richTextSchema.whenFormatRequested, /one object/);
assert.equal(request.task.richTextSchema.maxFormatsPerProperty, 1);
assert.equal(request.task.richTextSchema.arraysAllowed, false);
assert.equal(request.task.richTextSchema.nestedFormatsAllowed, false);
assert.equal(request.task.richTextSchema.unchangedExistingValues, "preserve verbatim");
assert.equal(request.task.blockSchemas.heading.props.text.formatSet, "f1");
assert.equal(request.task.blockSchemas.heading.props.text.formats, undefined,
  "rich-text schemas must reference shared formats instead of repeating their arrays");
assert.equal(request.task.blockSchemas.heading.props.text.accepts, undefined,
  "rich-text value variants must be declared once in task.richTextSchema");

const emptyListRequest = buildAiDraftRequest({
  messageAst: {
    id: "root", type: "document", props: {}, children: [
      { id: "list-empty", type: "list", props: { items: [] }, children: [], ai: { prompt: "Fill the list" } }
    ]
  },
  target: { kind: "draft", draftId: "draft-list", version: 1 },
  scope: { kind: "block", nodeId: "list-empty" },
  registry
});
assert.equal(emptyListRequest.task.blockSchemas.list.props.items.type, "array");
assert.equal(emptyListRequest.task.blockSchemas.list.props.items.items.props.blocks.type, "array");
assert.deepEqual(emptyListRequest.task.blockSchemas.list.props.items.items.props.blocks.items.example,
  { type: "paragraph", text: "Visible text" },
  "the registry must expose the otherwise invisible list-item block shape as structured JSON");
assert.equal(emptyListRequest.task.richTextSchema, undefined,
  "requests without rich-text properties must not carry an unused shared schema");
assert.equal(emptyListRequest.task.formatSets, undefined,
  "requests without formatter sets must not carry an empty catalog");

const repeatedTypesRequest = buildAiDraftRequest({
  messageAst: {
    id: "root", type: "document", props: {}, children: [
      ...Array.from({ length: 3 }, (_, index) => ({ id: `list-${index}`, type: "list", props: { items: [] }, children: [] })),
      ...Array.from({ length: 2 }, (_, index) => ({ id: `table-${index}`, type: "table", props: { cells: [] }, children: [] }))
    ]
  },
  registry
});
assert.deepEqual(Object.keys(repeatedTypesRequest.task.blockSchemas), ["list", "table"],
  "three lists and two tables must produce only two shared registry schemas");
assert.equal(repeatedTypesRequest.task.blockSchemas.table.props.cells.items.items.props.text.type, "rich-text");
assert.equal(repeatedTypesRequest.task.blockSchemas.table.props.cells.items.items.props.text.formatSet, "f1");
assert.equal(repeatedTypesRequest.task.blockSchemas.table.props.caption.formatSet, "f1");
assert.equal(Object.keys(repeatedTypesRequest.task.formatSets).length, 1,
  "all repeated full rich-text format arrays must be stored only once");
assert.match(repeatedTypesRequest.task.responseContract.join("\n"), /task\.blockSchemas\[block\.type\]/);
assert.match(repeatedTypesRequest.task.responseContract.join("\n"), /exactly one non-nested object.*task\.formatSets\[formatSet\]/);
assert.match(repeatedTypesRequest.task.responseContract.join("\n"), /Preserve unchanged existing rich-text values verbatim/);

const distinctFormatSetsRequest = buildAiDraftRequest({
  messageAst: {
    id: "root", type: "document", props: {}, children: [
      { id: "heading-formats", type: "heading", props: { text: "Title", level: 2 }, children: [] },
      { id: "code-formats", type: "preformatted", props: { text: "const x = 1;", language: "js" }, children: [] }
    ]
  },
  registry
});
assert.deepEqual(Object.keys(distinctFormatSetsRequest.task.formatSets), ["f1", "f2"]);
assert.equal(distinctFormatSetsRequest.task.blockSchemas.heading.props.text.formatSet, "f1");
assert.equal(distinctFormatSetsRequest.task.blockSchemas.preformatted.props.text.formatSet, "f2");
assert.deepEqual(distinctFormatSetsRequest.task.formatSets.f2, {
  simpleFormats: ["code"],
  simpleTemplate: { type: "<one simpleFormats value>", text: "string" }
},
  "genuinely different formatter sets must remain independently addressable");

const nestedBlockRequest = buildAiDraftRequest({
  messageAst: {
    id: "root", type: "document", props: {}, children: [
      {
        id: "details-1", type: "details", props: { summary: "More", open: false }, children: [
          { id: "paragraph-1", type: "paragraph", props: { text: "Nested" }, children: [] }
        ]
      }
    ]
  },
  registry
});
assert.equal(nestedBlockRequest.task.blockSchemas.details.children.items.schemaRef,
  "task.blockSchemas[item.type]", "nested children must refer to the same unique type registry");

const documentPromptRequest = buildAiDraftRequest({
  messageAst: ast,
  target: { kind: "draft", draftId: "draft-1", version: 7, includeFullContext: true },
  scope: { kind: "message" },
  registry,
  documentPrompt: "Fill the list and use its five items in the following five paragraphs."
});
assert.equal(documentPromptRequest.task.documentPrompt,
  "Fill the list and use its five items in the following five paragraphs.");
assert.match(documentPromptRequest.task.instruction, /task\.documentPrompt across every block it explicitly addresses/);
assert.match(documentPromptRequest.task.responseContract.at(-1), /coordinate changes across multiple explicitly referenced blocks/);

const isolatedBlockRequest = buildAiDraftRequest({
  messageAst: ast,
  scope: { kind: "block", nodeId: "heading-1" },
  registry,
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
  target: { kind: "draft", draftId: "draft-1", version: 7, chatId: -100123, channelId: -100456, messageId: 55 },
  registry
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

const wholeResponse = structuredClone(ast);
wholeResponse.children[0].props.text = "Whole-document title";
const wholeApplied = applyMessageAiResponse(ast, wholeResponse);
assert.equal(wholeApplied.children[0].props.text, "Whole-document title");
const structurallyChangedResponse = structuredClone(wholeResponse);
structurallyChangedResponse.children.pop();
assert.throws(() => applyMessageAiResponse(ast, structurallyChangedResponse), /структур|structure/i,
  "a whole-document AI response must not add, remove, reorder, or retype blocks");

assert.equal(isJsonDocument({ document: { file_name: "answer.json" } }), true);
assert.equal(isJsonDocument({ document: { file_name: "payload.bin", mime_type: "application/json" } }), true);
assert.equal(isJsonDocument({ document: { file_name: "notes.pdf", mime_type: "application/pdf" } }), false,
  "only JSON documents must be excluded from Gallery ingestion");

const runtimeRows = new Map();
const db = {
  async get(store, key, fallback = null) { return runtimeRows.has(`${store}:${key}`) ? runtimeRows.get(`${store}:${key}`) : fallback; },
  async put(store, key, value) { runtimeRows.set(`${store}:${key}`, structuredClone(value)); },
  async delete(store, key) { runtimeRows.delete(`${store}:${key}`); },
  async deleteMany(entries) { for (const { store, key } of entries) runtimeRows.delete(`${store}:${key}`); },
  async all(store) {
    const prefix = `${store}:`;
    return [...runtimeRows]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key: key.slice(prefix.length), value: structuredClone(value) }));
  }
};
let storedAst = structuredClone(ast);
let botOpenCalls = 0;
const responseInput = { value: "" };
const invalidResponseReports = [];
const conflictPrompts = [];
const createdDrafts = [];
let conflictChoice = null;
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
  input: responseInput,
  registry,
  invalidResponseReporter(options) { invalidResponseReports.push(options); },
  tree: { root: storedAst, toJSON: () => structuredClone(storedAst) },
  draftSession,
  drafts,
  documents: { async saveCurrentContext() {} },
  navigation: { openBot() { botOpenCalls += 1; return true; } },
  conflictResolver(options) { conflictPrompts.push(options); return conflictChoice; },
  notifications: { show() {} }
});
exchange.start();
assert.equal(exchange.openBot(), true);
assert.equal(botOpenCalls, 1);
await exchange.open();
const wholeDraftPayload = JSON.parse(responseInput.value);
assert.equal(wholeDraftPayload.task.documentPrompt, "Coordinate every prompted block.");
assert.equal(wholeDraftPayload.messageAst.children.length, 2,
  "right-panel document AI includes the entire draft context");
await exchange.open({ nodeId: "heading-1" });
const manualPayload = JSON.parse(responseInput.value);
assert.equal(manualPayload.task.documentPrompt, undefined,
  "opening AI JSON from a Canvas block must ignore the right-panel document prompt");
assert.equal(await exchange.importText("{invalid response", { showInvalidDialog: true }), null);
assert.equal(invalidResponseReports.length, 1);
assert.match(invalidResponseReports.at(-1).message, /некорректный JSON|invalid JSON/i);

assert.equal(manualPayload.request.scope.kind, "field");
assert.equal(manualPayload.request.contextIncluded, "block");
assert.equal(manualPayload.messageAst.children.length, 1,
  "Block AI JSON must stay isolated even when the card's full-context checkbox is enabled");
wholeDraftPayload.messageAst.children[0].props.text = "Whole-draft title";
const wholeDraftImported = await exchange.importText(JSON.stringify(wholeDraftPayload));
assert.ok(wholeDraftImported);
assert.equal(storedAst.children[0].props.text, "Whole-draft title",
  "a whole-draft AI response must update its source draft");
assert.equal(createdDrafts.length, 0,
  "a whole-draft AI response must not create a separate AI draft without a version conflict");
manualPayload.messageAst.children[0].props.text = "Imported title";
const imported = await exchange.importText(JSON.stringify(manualPayload));
assert.ok(imported);
assert.equal(storedAst.children[0].props.text, "Imported title");

activeDraft.updatedAt = 9;
manualPayload.messageAst.children[0].props.text = "Conflicting title";
const sentRequestKey = `runtime:ai.request:${manualPayload.request.id}`;
runtimeRows.set(sentRequestKey, {
  requestId: manualPayload.request.id,
  target: structuredClone(manualPayload.request.target),
  scope: structuredClone(manualPayload.request.scope),
  contextIncluded: "block",
  createdAt: Date.now()
});
conflictChoice = null;
const cancelledConflict = await exchange.importText(JSON.stringify(manualPayload));
assert.equal(cancelledConflict, null);
assert.equal(storedAst.children[0].props.text, "Imported title", "closing the conflict dialog changes nothing");
assert.equal(createdDrafts.length, 0, "a version conflict must not create a draft without an explicit choice");
assert.equal(conflictPrompts.length, 1);
assert.equal(runtimeRows.has(sentRequestKey), true,
  "cancelling keeps the pending exchange available for another import attempt");

conflictChoice = "apply-current";
await exchange.importText(JSON.stringify(manualPayload));
assert.equal(storedAst.children[0].props.text, "Conflicting title", "the current block changes only after confirmation");
assert.equal(runtimeRows.has(sentRequestKey), false, "a completed conflict choice cleans up the exchange");

conflictChoice = "new-draft";
manualPayload.messageAst.children[0].props.text = "Forked title";
await exchange.importText(JSON.stringify(manualPayload));
assert.equal(createdDrafts.length, 1, "a conflict fork is created only after that explicit choice");
assert.equal(createdDrafts[0].messageAst.children[0].props.text, "Forked title");
assert.equal(createdDrafts[0].source.importedVia, "manual");

let projectAst = structuredClone(ast);
const projectPost = {
  id: "post-1",
  title: "Project post",
  messageAst: projectAst,
  updatedAt: 12,
  ai: { includeFullContext: true, documentPrompt: "Rewrite the whole post." }
};
let openedProjectPost = null;
const projectSession = {
  activeProjectId: "project-1",
  activePostId: projectPost.id,
  isProjectActive: () => true,
  snapshot() {
    return {
      activeProjectId: this.activeProjectId,
      activePostId: this.activePostId,
      project: { id: this.activeProjectId, title: "Project", posts: [{ ...projectPost, messageAst: structuredClone(projectAst) }] }
    };
  },
  store: {
    async getPost(projectId, postId) {
      return projectId === "project-1" && postId === projectPost.id
        ? { ...projectPost, messageAst: structuredClone(projectAst) }
        : null;
    },
    async savePostAst(projectId, postId, nextAst) {
      assert.equal(projectId, "project-1");
      assert.equal(postId, projectPost.id);
      projectAst = structuredClone(nextAst);
    }
  }
};
const projectExchange = new AiDraftExchange({
  db,
  input: responseInput,
  registry,
  tree: { root: projectAst, toJSON: () => structuredClone(projectAst) },
  draftSession: { isActive: () => false },
  projectSession,
  drafts,
  documents: {
    async saveCurrentContext() {},
    async openProjectPost(projectId, postId) { openedProjectPost = { projectId, postId }; }
  },
  notifications: { show() {} }
});
await projectExchange.open();
const wholePostPayload = JSON.parse(responseInput.value);
wholePostPayload.messageAst.children[0].props.text = "Whole-project-post title";
const wholePostImported = await projectExchange.importText(JSON.stringify(wholePostPayload));
assert.ok(wholePostImported);
assert.equal(projectAst.children[0].props.text, "Whole-project-post title",
  "a whole-post AI response must update its source Project post");
assert.deepEqual(openedProjectPost, { projectId: "project-1", postId: "post-1" });
assert.equal(createdDrafts.length, 1,
  "updating a whole Project post must not create another AI draft");

const pruningExchange = new AiDraftExchange({
  db,
  input: responseInput,
  registry,
  tree: { root: storedAst, toJSON: () => structuredClone(storedAst) },
  draftSession,
  drafts,
  documents: { async saveCurrentContext() {} },
  notifications: { show() {} }
});
await pruningExchange.open({ nodeId: "heading-1" });
const supersededRequestId = JSON.parse(responseInput.value).request.id;
await pruningExchange.open({ nodeId: "heading-1" });
const currentRequestId = JSON.parse(responseInput.value).request.id;
assert.equal(runtimeRows.has(`runtime:ai.request:${supersededRequestId}`), false,
  "opening the same AI scope again must discard its superseded pending request");
assert.equal(runtimeRows.has(`runtime:ai.request:${currentRequestId}`), true);

runtimeRows.set("runtime:ai.request:expired", {
  requestId: "expired",
  target: { kind: "draft", draftId: "another-draft" },
  scope: { kind: "message" },
  createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000
});
await pruningExchange.cleanupPendingRequests();
assert.equal(runtimeRows.has("runtime:ai.request:expired"), false,
  "pending AI requests older than the retention period must be removed");
for (let index = 0; index < 40; index += 1) {
  runtimeRows.set(`runtime:ai.request:bounded-${index}`, {
    requestId: `bounded-${index}`,
    target: { kind: "draft", draftId: `bounded-draft-${index}` },
    scope: { kind: "message" },
    createdAt: Date.now() + index
  });
}
await pruningExchange.cleanupPendingRequests();
assert.equal(
  [...runtimeRows.keys()].filter(key => key.startsWith("runtime:ai.request:")).length,
  32,
  "pending AI request storage must remain bounded"
);

const [html, editorCss, shellSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles/editor.css", import.meta.url), "utf8"),
  readFile(new URL("../js/app/createEditorShell.js", import.meta.url), "utf8")
]);
assert.doesNotMatch(html, /id="aiDraftPaste"|id="aiDraftSend"/,
  "CORS-dependent clipboard and bot transport actions must not be exposed");
assert.match(html, /id="aiDraftImport"[\s\S]*?id="aiDraftOpenBot"/,
  "manual import stays on the left while Open bot remains the final action");
assert.match(editorCss, /\.button-like \{[\s\S]*?font-size: 9px;/,
  "the response file label must use the same compact font size as dialog buttons");
assert.match(editorCss, /#aiDraftOpenBot \{ margin-left: auto; \}/,
  "Open bot must remain separated on the right");
assert.doesNotMatch(shellSource, /aiDraftPaste|aiDraftSend|pasteButton|sendButton/);

console.log("ai draft exchange smoke: ok");
