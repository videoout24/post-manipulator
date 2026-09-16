import { randomUUID } from "../core/Random.js?v=1.5.9";
import { t } from "../i18n/index.js?v=1.9.8";
import { chooseDarkDialog, showDarkMessage } from "../core/DarkDialog.js?v=1.9.6";

export const AI_DRAFT_FORMAT = "rich-current-ai-draft";
export const AI_DRAFT_SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BLOCKS = 500;
const MAX_IMPORT_DEPTH = 32;

export class AiDraftExchange {
  constructor({
    dialog,
    input,
    openButton,
    closeButton,
    copyButton,
    downloadButton,
    sendButton,
    openBotButton,
    pasteButton,
    importButton,
    fileInput,
    tree,
    draftSession,
    projectSession,
    drafts,
    documents,
    client,
    navigation,
    ownerBinding,
    db = null,
    events = null,
    notifications = null,
    conflictResolver = null,
    invalidResponseReporter = null,
    clipboard = globalThis.navigator?.clipboard,
    documentRoot = globalThis.document
  } = {}) {
    Object.assign(this, {
      dialog, input, openButton, closeButton, copyButton, downloadButton,
      sendButton, openBotButton, pasteButton, importButton, fileInput, tree, draftSession, projectSession,
      drafts, documents, client, navigation, ownerBinding, events, notifications, documentRoot
    });
    this.db = db;
    this.conflictResolver = conflictResolver;
    this.invalidResponseReporter = invalidResponseReporter;
    this.clipboard = clipboard;
    this.unsubscribers = [];
    this.currentScope = null;
    this.preparedPayload = null;
    this.awaitingClipboardPaste = false;
  }

  start() {
    this.#listen(this.openButton, "click", () => this.open());
    this.#listen(this.closeButton, "click", () => {
      this.awaitingClipboardPaste = false;
      this.dialog?.close?.();
    });
    this.#listen(this.copyButton, "click", () => this.copy());
    this.#listen(this.downloadButton, "click", () => this.download());
    this.#listen(this.sendButton, "click", () => this.sendToBot());
    this.#listen(this.openBotButton, "click", () => this.openBot());
    this.#listen(this.pasteButton, "click", () => this.pasteAndImport());
    this.#listen(this.input, "paste", event => this.#handleClipboardPaste(event));
    this.#listen(this.importButton, "click", () => this.importText(this.input?.value));
    this.#listen(this.fileInput, "change", event => this.importFile(event.target?.files?.[0]));
    this.unsubscribers.push(
      this.events?.on?.("telegram:ai-draft-response", event => this.importText(event?.text, { viaTelegram: true, telegramSource: event?.source })),
      this.events?.on?.("telegram:ai-draft-text-part", event => {
        if (event?.complete) return;
        this.#notify({
          message: t("editor.aiDraftExchange.telegramTextPartReceived", {
            0: Number(event?.received || 0),
            1: Number(event?.total || 0)
          }),
          type: "info",
          duration: 5000
        });
      }),
      this.events?.on?.("telegram:ai-draft-text-part-error", () => this.#notify({
        message: t("editor.aiDraftExchange.fileTooLarge"),
        type: "error",
        duration: 9000
      })),
      this.events?.on?.("ai:block-export-requested", event => this.open({ nodeId: event?.nodeId })),
      this.events?.on?.("ai:document-open-requested", () => {
        this.currentScope = null;
        this.preparedPayload = null;
        return this.open();
      }),
      this.events?.on?.("telegram:ai-draft-document", event => this.#rememberIncomingDocument(event))
    );
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  async open(scope = null) {
    try {
      this.awaitingClipboardPaste = false;
      this.currentScope = scope?.nodeId ? { nodeId: String(scope.nodeId) } : null;
      const payload = await this.buildRequest();
      this.preparedPayload = structuredClone(payload);
      if (this.input) this.input.value = JSON.stringify(payload, null, 2);
      this.dialog?.showModal?.();
    } catch (error) {
      this.#error(error);
    }
  }

  async buildRequest() {
    await this.documents?.saveCurrentContext?.();
    const target = await this.#currentTarget();
    const fullAst = this.tree?.toJSON?.();
    let messageAst = fullAst;
    let scope = { kind: "message" };
    if (this.currentScope?.nodeId) {
      const node = findAstNode(fullAst, this.currentScope.nodeId);
      if (!node) throw new Error(t("editor.aiDraftExchange.targetBlockNotFound"));
      if (!String(node.ai?.prompt || "").trim()) throw new Error(t("editor.aiDraftExchange.promptRequired"));
      scope = {
        kind: node.ai?.field ? "field" : "block",
        nodeId: String(node.id),
        ...(node.ai?.field ? { field: String(node.ai.field) } : {})
      };
      messageAst = { id: "root", type: "document", props: {}, children: [structuredClone(node)] };
    }
    const documentPrompt = scope.kind === "message" && target.includeFullContext
      ? String(target.documentPrompt || "").trim()
      : "";
    const payload = buildAiDraftRequest({
      messageAst,
      target,
      scope,
      documentPrompt,
      contextIncluded: messageAst === fullAst ? "message" : "block"
    });
    await this.#rememberRequestDefinition(payload);
    return payload;
  }

  async copy() {
    try {
      const text = String(this.input?.value || "");
      if (!text) throw new Error(t("editor.aiDraftExchange.nothingToCopy"));
      await globalThis.navigator?.clipboard?.writeText?.(text);
      this.#notify({ message: t("editor.aiDraftExchange.copied"), type: "success" });
    } catch (error) {
      this.#error(error);
    }
  }

  download() {
    try {
      const text = String(this.input?.value || "");
      if (!text) throw new Error(t("editor.aiDraftExchange.nothingToDownload"));
      const payload = parseAiDraftResponse(text);
      const fileName = aiFileName(payload);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = this.documentRoot.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      this.#error(error);
    }
  }

  async sendToBot() {
    try {
      const payload = this.preparedPayload || await this.buildRequest();
      this.preparedPayload = structuredClone(payload);
      const text = JSON.stringify(payload, null, 2);
      if (this.input) this.input.value = text;
      const owner = await this.ownerBinding?.getOwner?.();
      if (!owner?.chatId) throw new Error(t("editor.aiDraftExchange.ownerNotBound"));
      const file = makeJsonFile(text, aiFileName(payload));
      const sent = await this.client?.uploadDocument?.({
        chatId: owner.chatId,
        file,
        caption: t("editor.aiDraftExchange.telegramCaption", { 0: payload.request.id })
      });
      await this.#rememberSentRequest(payload, {
        chatId: Number(owner.chatId),
        messageId: Number(sent?.message_id || 0)
      });
      this.#notify({ message: t("editor.aiDraftExchange.sentToBot"), type: "success" });
    } catch (error) {
      this.#error(error);
    }
  }

  openBot() {
    try {
      const opened = this.navigation?.openBot?.();
      if (!opened) throw new Error(t("editor.aiDraftExchange.botUsernameUnavailable"));
      return true;
    } catch (error) {
      this.#error(error);
      return false;
    }
  }

  async importFile(file) {
    if (!file) return;
    try {
      if (Number(file.size || 0) > MAX_IMPORT_BYTES) throw new Error(t("editor.aiDraftExchange.fileTooLarge"));
      const text = await file.text();
      let telegramSource = null;
      try {
        const requestId = parseAiDraftResponse(text)?.request?.id;
        telegramSource = await this.db?.get?.("runtime", aiResponseKey(requestId), null);
      } catch { /* importText reports malformed response consistently */ }
      await this.importText(text, { telegramSource });
    } catch (error) {
      this.#error(error);
    } finally {
      if (this.fileInput) this.fileInput.value = "";
    }
  }

  async pasteAndImport() {
    try {
      if (typeof this.clipboard?.readText !== "function") {
        return this.#armClipboardPasteFallback();
      }
      const text = await this.clipboard.readText();
      if (this.input) this.input.value = String(text || "");
      return this.importText(text, { viaClipboard: true, showInvalidDialog: true });
    } catch (error) {
      return this.#armClipboardPasteFallback(error);
    }
  }

  #armClipboardPasteFallback() {
    this.awaitingClipboardPaste = true;
    this.input?.focus?.();
    this.input?.select?.();
    this.#notify({
      message: t("editor.aiDraftExchange.clipboardPasteReady"),
      type: "warning",
      duration: 9000
    });
    return null;
  }

  #handleClipboardPaste(event) {
    if (!this.awaitingClipboardPaste) return;
    const text = String(event?.clipboardData?.getData?.("text/plain") || "");
    if (!text) return;
    event.preventDefault?.();
    this.awaitingClipboardPaste = false;
    if (this.input) this.input.value = text;
    void this.importText(text, { viaClipboard: true, showInvalidDialog: true });
  }

  async importText(text, { viaTelegram = false, viaClipboard = false, showInvalidDialog = false, telegramSource = null } = {}) {
    try {
      await this.documents?.saveCurrentContext?.();
      const payload = parseAiDraftResponse(text);
      const issued = await this.#issuedRequest(payload.request?.id);
      if (issued) {
        payload.request.target = structuredClone(issued.target || {});
        payload.request.scope = structuredClone(issued.scope || { kind: "message" });
        payload.request.contextIncluded = issued.contextIncluded === "block" ? "block" : "message";
      }
      let ast = payload.messageAst;
      const original = await this.#originalAst(payload.request?.target);
      if (original) ast = mergeMissingAiPrompts(ast, original);
      const target = payload.request?.target || {};
      const scope = payload.request?.scope || { kind: "message" };
      if (["block", "field"].includes(scope.kind) && target.kind === "draft" && target.draftId) {
        const result = await this.#importScopedDraft(payload, ast, { viaTelegram, viaClipboard });
        if (result) await this.#cleanupTelegramExchange(payload.request?.id, telegramSource);
        return result;
      }
      if (["block", "field"].includes(scope.kind) && target.kind === "project-post" && target.projectId && target.postId) {
        const result = await this.#importScopedProjectPost(payload, ast, { viaTelegram, viaClipboard });
        if (result) await this.#cleanupTelegramExchange(payload.request?.id, telegramSource);
        return result;
      }
      const title = t("editor.aiDraftExchange.importedDraftTitle", {
        0: String(target.title || t("editor.draftListView.draft"))
      });
      const draft = await this.drafts.create({
        title,
        messageAst: ast,
        source: {
          kind: "ai-response",
          requestId: String(payload.request?.id || ""),
          target: structuredClone(target),
          importedVia: importSource({ viaTelegram, viaClipboard })
        }
      });
      await this.documents?.openDraft?.(draft.id);
      this.dialog?.close?.();
      this.preparedPayload = null;
      this.#notify({ message: t("editor.aiDraftExchange.imported", { 0: draft.title }), type: "success", duration: 7000 });
      await this.#cleanupTelegramExchange(payload.request?.id, telegramSource);
      return draft;
    } catch (error) {
      if (showInvalidDialog) await this.#reportInvalidResponse(error);
      else this.#error(error);
      return null;
    }
  }

  async #currentTarget() {
    if (this.draftSession?.isActive?.()) {
      const draft = await this.drafts?.get?.(this.draftSession.activeDraftId)
        || this.draftSession.snapshot?.().draft || this.draftSession.draft || {};
      return {
        kind: "draft",
        draftId: String(draft.id || this.draftSession.activeDraftId || ""),
        title: String(draft.title || ""),
        version: Number(draft.updatedAt || 0),
        includeFullContext: draft.ai?.includeFullContext === true,
        documentPrompt: String(draft.ai?.documentPrompt || "")
      };
    }
    if (this.projectSession?.isProjectActive?.()) {
      const snapshot = this.projectSession.snapshot?.() || {};
      const post = snapshot.project?.posts?.find(item => String(item.id) === String(snapshot.activePostId));
      return {
        kind: "project-post",
        projectId: String(snapshot.activeProjectId || ""),
        postId: String(snapshot.activePostId || ""),
        title: String(post?.title || snapshot.project?.title || ""),
        version: Number(post?.updatedAt || 0),
        includeFullContext: post?.ai?.includeFullContext === true,
        documentPrompt: String(post?.ai?.documentPrompt || "")
      };
    }
    return { kind: "canvas", title: "" };
  }

  async #importScopedDraft(payload, responseAst, { viaTelegram = false, viaClipboard = false } = {}) {
    const target = payload.request.target;
    const scope = payload.request.scope;
    const current = await this.drafts?.get?.(target.draftId);
    if (!current) throw new Error(t("editor.aiDraftExchange.sourceDraftNotFound"));
    const patchedAst = applyScopedAiResponse(current.messageAst, responseAst, scope);
    const sameVersion = Number(current.updatedAt || 0) === Number(target.version || 0);
    if (!sameVersion) {
      const choice = await this.#resolveVersionConflict(current.title);
      if (choice === "new-draft") return this.#createConflictFork(payload, patchedAst, current.title, { viaTelegram, viaClipboard });
      if (choice !== "apply-current") return null;
    }

    const saved = await this.drafts.saveAst(current.id, patchedAst);
    if (this.draftSession?.activeDraftId === current.id) {
      this.tree.root = structuredClone(saved.messageAst);
      this.draftSession.activate(saved, { reason: "ai-patched" });
    } else {
      await this.documents?.openDraft?.(saved.id);
    }
    this.dialog?.close?.();
    this.preparedPayload = null;
    this.#notify({ message: t("editor.aiDraftExchange.patched", { 0: current.title }), type: "success", duration: 7000 });
    return saved;
  }

  async #importScopedProjectPost(payload, responseAst, { viaTelegram = false, viaClipboard = false } = {}) {
    const target = payload.request.target;
    const scope = payload.request.scope;
    const post = await this.projectSession?.store?.getPost?.(target.projectId, target.postId);
    if (!post) throw new Error(t("editor.aiDraftExchange.sourcePostNotFound"));
    const patchedAst = applyScopedAiResponse(post.messageAst, responseAst, scope);
    const sameVersion = Number(post.updatedAt || 0) === Number(target.version || 0);
    if (!sameVersion) {
      const choice = await this.#resolveVersionConflict(post.title);
      if (choice === "new-draft") return this.#createConflictFork(payload, patchedAst, post.title, { viaTelegram, viaClipboard });
      if (choice !== "apply-current") return null;
    }

    await this.projectSession.store.savePostAst(target.projectId, target.postId, patchedAst);
    await this.documents?.openProjectPost?.(target.projectId, target.postId);
    this.dialog?.close?.();
    this.preparedPayload = null;
    this.#notify({ message: t("editor.aiDraftExchange.postPatched", { 0: post.title }), type: "success", duration: 7000 });
    return this.projectSession?.snapshot?.() || true;
  }

  async #resolveVersionConflict(title) {
    const options = {
      title: t("editor.aiDraftExchange.versionConflictTitle"),
      message: t("editor.aiDraftExchange.versionConflictMessage", { 0: title }),
      choices: [
        { value: "apply-current", label: t("editor.aiDraftExchange.versionConflictApplyCurrent") },
        { value: "new-draft", label: t("editor.aiDraftExchange.versionConflictCreateDraft"), className: "primary" }
      ]
    };
    return this.conflictResolver ? this.conflictResolver(options) : chooseDarkDialog(options);
  }

  async #createConflictFork(payload, patchedAst, title, { viaTelegram = false, viaClipboard = false } = {}) {
    const fork = await this.drafts.create({
      title: t("editor.aiDraftExchange.importedDraftTitle", { 0: title }),
      messageAst: patchedAst,
      source: {
        kind: "ai-response",
        requestId: String(payload.request?.id || ""),
        target: structuredClone(payload.request?.target || {}),
        importedVia: importSource({ viaTelegram, viaClipboard }),
        versionConflict: true
      }
    });
    await this.documents?.openDraft?.(fork.id);
    this.dialog?.close?.();
    this.preparedPayload = null;
    this.#notify({ message: t("editor.aiDraftExchange.versionConflictForked", { 0: fork.title }), type: "warning", duration: 9000 });
    return fork;
  }

  async #originalAst(target = {}) {
    if (target.kind === "draft" && target.draftId) {
      return (await this.drafts?.get?.(target.draftId))?.messageAst || null;
    }
    if (target.kind === "project-post") {
      const snapshot = this.projectSession?.snapshot?.() || {};
      if (String(snapshot.activeProjectId || "") !== String(target.projectId || "")) return null;
      return snapshot.project?.posts?.find(item => String(item.id) === String(target.postId))?.messageAst || null;
    }
    return null;
  }

  async #rememberSentRequest(payload, source) {
    const requestId = String(payload?.request?.id || "");
    if (!requestId || !source?.chatId || !source?.messageId || !this.db?.put) return;
    const previous = await this.db.get("runtime", aiRequestKey(requestId), null);
    const record = {
      ...(previous || {}),
      requestId,
      chatId: Number(source.chatId),
      requestMessageId: Number(source.messageId),
      target: structuredClone(payload.request.target || {}),
      scope: structuredClone(payload.request.scope || { kind: "message" }),
      contextIncluded: payload.request.contextIncluded === "block" ? "block" : "message",
      createdAt: Date.now()
    };
    await this.db.put("runtime", aiRequestKey(requestId), record);
    await this.db.put("runtime", aiRequestMessageKey(record.chatId, record.requestMessageId), requestId);
  }

  async #rememberRequestDefinition(payload) {
    const requestId = String(payload?.request?.id || "");
    if (!requestId || !this.db?.put) return;
    await this.db.put("runtime", aiRequestKey(requestId), {
      requestId,
      target: structuredClone(payload.request.target || {}),
      scope: structuredClone(payload.request.scope || { kind: "message" }),
      contextIncluded: payload.request.contextIncluded === "block" ? "block" : "message",
      createdAt: Date.now()
    });
  }

  async #issuedRequest(requestId) {
    const id = String(requestId || "");
    return id && this.db?.get ? this.db.get("runtime", aiRequestKey(id), null) : null;
  }

  async #rememberIncomingDocument(event = {}) {
    try {
      const source = event.source || {};
      let requestId = requestIdFromFileName(event.fileName);
      if (!requestId && source.replyToMessageId && this.db?.get) {
        requestId = await this.db.get("runtime", aiRequestMessageKey(source.chatId, source.replyToMessageId), "");
      }
      if (requestId && this.db?.put) {
        await this.db.put("runtime", aiResponseKey(requestId), {
          chatId: Number(source.chatId || 0),
          messageId: Number(source.messageId || 0),
          replyToMessageId: Number(source.replyToMessageId || 0)
        });
      }
    } finally {
      this.#notify({
        message: t("editor.aiDraftExchange.telegramDocumentNeedsLocalImport"),
        type: "warning",
        duration: 9000
      });
    }
  }

  async #cleanupTelegramExchange(requestId, responseSource = null) {
    const id = String(requestId || "");
    const request = id && this.db?.get ? await this.db.get("runtime", aiRequestKey(id), null) : null;
    const response = responseSource || (id && this.db?.get ? await this.db.get("runtime", aiResponseKey(id), null) : null);
    let retryNeeded = false;
    for (const source of uniqueTelegramMessages([response, request && {
      chatId: request.chatId,
      messageId: request.requestMessageId
    }])) {
      try {
        await this.client?.deleteMessage?.(source.chatId, source.messageId);
      } catch (error) {
        if (!error?.isMessageMissing?.()) {
          retryNeeded = true;
          this.#notify({ message: t("editor.aiDraftExchange.cleanupWarning", { 0: error?.message || error }), type: "warning", duration: 7000 });
        }
      }
    }
    if (!retryNeeded && id && this.db?.delete) {
      await this.db.delete("runtime", aiRequestKey(id));
      await this.db.delete("runtime", aiResponseKey(id));
      if (request?.chatId && request?.requestMessageId) {
        await this.db.delete("runtime", aiRequestMessageKey(request.chatId, request.requestMessageId));
      }
    }
  }

  #listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    this.unsubscribers.push(() => target.removeEventListener(name, handler));
  }

  #notify(payload) { this.notifications?.show?.(payload); }
  #reportInvalidResponse(error) {
    const options = {
      title: t("editor.aiDraftExchange.invalidClipboardTitle"),
      message: t("editor.aiDraftExchange.invalidClipboardMessage", { 0: error?.message || error })
    };
    return this.invalidResponseReporter
      ? this.invalidResponseReporter(options)
      : showDarkMessage(options);
  }
  #error(error) {
    this.#notify({ message: t("editor.aiDraftExchange.error", { 0: error?.message || error }), type: "error", duration: 9000 });
  }
}

function importSource({ viaTelegram = false, viaClipboard = false } = {}) {
  if (viaTelegram) return "telegram-text";
  return viaClipboard ? "clipboard" : "manual";
}

export function buildAiDraftRequest({
  messageAst,
  target = {},
  scope = { kind: "message" },
  documentPrompt = "",
  contextIncluded = "message",
  requestId = randomUUID(),
  createdAt = Date.now()
} = {}) {
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) throw new Error(t("editor.aiDraftExchange.requestIdRequired"));
  const ast = validateAiAst(sanitizeAiValue(messageAst));
  const normalizedScope = normalizeScope(scope);
  const normalizedDocumentPrompt = normalizedScope.kind === "message" ? String(documentPrompt || "").trim() : "";
  const schemaRules = aiResponseSchemaRules(ast);
  return {
    format: AI_DRAFT_FORMAT,
    schemaVersion: AI_DRAFT_SCHEMA_VERSION,
    request: {
      id: normalizedRequestId,
      createdAt: new Date(createdAt).toISOString(),
      target: publicAiTarget(target),
      scope: normalizedScope,
      contextIncluded: contextIncluded === "block" ? "block" : "message"
    },
    task: {
      instruction: taskInstruction(normalizedScope, normalizedDocumentPrompt),
      ...(normalizedDocumentPrompt ? { documentPrompt: normalizedDocumentPrompt } : {}),
      responseContract: [
        "Return the complete JSON object only.",
        "Preserve format, schemaVersion, request, task, block id/type/children, and every ai.prompt.",
        ...schemaRules,
        normalizedScope.kind === "field"
          ? `Change only props.${normalizedScope.field} of block ${normalizedScope.nodeId}; keep all other data unchanged.`
          : normalizedScope.kind === "block"
            ? `Change only the content of block ${normalizedScope.nodeId}; keep its identity and structure unchanged.`
            : normalizedDocumentPrompt
              ? "Change props only where task.documentPrompt or an ai.prompt requests a change. A documentPrompt may coordinate changes across multiple explicitly referenced blocks; keep all other data unchanged."
              : "Change props only where an ai.prompt requests a change; keep all other data unchanged."
      ]
    },
    messageAst: ast
  };
}

export function parseAiDraftResponse(input) {
  if (typeof input === "string" && byteLength(input) > MAX_IMPORT_BYTES) throw new Error(t("editor.aiDraftExchange.fileTooLarge"));
  let value = input;
  if (typeof value === "string") {
    const source = stripCodeFence(value).trim();
    if (!source) throw new Error(t("editor.aiDraftExchange.emptyResponse"));
    try { value = JSON.parse(source); }
    catch { throw new Error(t("editor.aiDraftExchange.invalidJson")); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("editor.aiDraftExchange.invalidEnvelope"));
  if (value.format !== AI_DRAFT_FORMAT) throw new Error(t("editor.aiDraftExchange.invalidFormat"));
  if (Number(value.schemaVersion) !== AI_DRAFT_SCHEMA_VERSION) throw new Error(t("editor.aiDraftExchange.unsupportedVersion"));
  const requestId = String(value.request?.id || "").trim();
  if (!requestId) throw new Error(t("editor.aiDraftExchange.requestIdRequired"));
  return {
    format: AI_DRAFT_FORMAT,
    schemaVersion: AI_DRAFT_SCHEMA_VERSION,
    request: {
      id: requestId,
      createdAt: String(value.request?.createdAt || ""),
      target: publicAiTarget(value.request?.target),
      scope: normalizeScope(value.request?.scope),
      contextIncluded: value.request?.contextIncluded === "block" ? "block" : "message"
    },
    task: value.task && typeof value.task === "object" ? sanitizeAiValue(value.task) : {},
    messageAst: validateAiAst(sanitizeAiValue(value.messageAst))
  };
}

export function validateAiAst(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.type !== "document") {
    throw new Error(t("editor.aiDraftExchange.invalidAst"));
  }
  const ids = new Set();
  let count = 0;
  const visit = (node, depth, root = false) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error(t("editor.aiDraftExchange.invalidBlock"));
    if (depth > MAX_IMPORT_DEPTH) throw new Error(t("editor.aiDraftExchange.tooDeep"));
    if (++count > MAX_IMPORT_BLOCKS) throw new Error(t("editor.aiDraftExchange.tooManyBlocks"));
    const id = root ? "root" : String(node.id || "").trim();
    const type = root ? "document" : String(node.type || "").trim();
    if (!id || !type) throw new Error(t("editor.aiDraftExchange.blockIdentityRequired"));
    if (ids.has(id)) throw new Error(t("editor.aiDraftExchange.duplicateBlockId", { 0: id }));
    ids.add(id);
    if (node.props != null && (typeof node.props !== "object" || Array.isArray(node.props))) {
      throw new Error(t("editor.aiDraftExchange.invalidBlockProps", { 0: id }));
    }
    const copy = {
      id,
      type,
      props: normalizeAiBlockProps(type, node.props || {}),
      children: []
    };
    if (node.ai?.prompt != null) {
      const prompt = String(node.ai.prompt);
      if (byteLength(prompt) > 64 * 1024) throw new Error(t("editor.aiDraftExchange.promptTooLarge", { 0: id }));
      if (prompt.trim()) copy.ai = {
        prompt,
        ...(String(node.ai?.field || "").trim() ? { field: String(node.ai.field).trim() } : {})
      };
    }
    if (!Array.isArray(node.children || [])) throw new Error(t("editor.aiDraftExchange.invalidBlockChildren", { 0: id }));
    copy.children = (node.children || []).map(child => visit(child, depth + 1));
    return copy;
  };
  return visit(input, 0, true);
}

export function mergeMissingAiPrompts(responseAst, originalAst) {
  const result = validateAiAst(responseAst);
  const prompts = new Map();
  walkAst(originalAst, node => {
    const prompt = String(node?.ai?.prompt || "");
    if (prompt.trim()) prompts.set(String(node.id), structuredClone(node.ai));
  });
  walkAst(result, node => {
    if (String(node?.ai?.prompt || "").trim()) return;
    const ai = prompts.get(String(node.id));
    if (ai) node.ai = ai;
  });
  return result;
}

export function applyScopedAiResponse(currentAst, responseAst, scope = {}) {
  const current = validateAiAst(currentAst);
  const response = validateAiAst(responseAst);
  const target = findAstNode(current, scope.nodeId);
  const returned = findAstNode(response, scope.nodeId);
  if (!target || !returned) throw new Error(t("editor.aiDraftExchange.targetBlockNotFound"));
  if (target.type !== returned.type) throw new Error(t("editor.aiDraftExchange.targetBlockTypeChanged"));

  if (scope.kind === "field") {
    const field = String(scope.field || "").trim();
    if (!field) throw new Error(t("editor.aiDraftExchange.targetFieldRequired"));
    if (!Object.prototype.hasOwnProperty.call(returned.props || {}, field)) {
      throw new Error(t("editor.aiDraftExchange.targetFieldMissing", { 0: field }));
    }
    target.props ||= {};
    target.props[field] = structuredClone(returned.props?.[field]);
    if (!target.ai?.prompt && returned.ai?.prompt) target.ai = structuredClone(returned.ai);
    return current;
  }

  if (scope.kind !== "block") throw new Error(t("editor.aiDraftExchange.invalidScope"));
  if (blockShape(target) !== blockShape(returned)) throw new Error(t("editor.aiDraftExchange.targetBlockStructureChanged"));
  replaceAstNode(current, target.id, returned);
  return mergeMissingAiPrompts(current, currentAst);
}

export function isAiDraftResponseText(text) {
  const source = stripCodeFence(String(text || "")).trim();
  if (!source.includes(`"format"`) || !source.includes(AI_DRAFT_FORMAT)) return false;
  try {
    const value = JSON.parse(source);
    return value?.format === AI_DRAFT_FORMAT;
  } catch {
    return false;
  }
}

function normalizeScope(scope = {}) {
  const kind = ["message", "block", "field"].includes(scope?.kind) ? scope.kind : "message";
  if (kind === "message") return { kind };
  const nodeId = String(scope?.nodeId || "").trim();
  if (!nodeId) throw new Error(t("editor.aiDraftExchange.targetBlockNotFound"));
  if (kind === "field") {
    const field = String(scope?.field || "").trim();
    if (!field) throw new Error(t("editor.aiDraftExchange.targetFieldRequired"));
    return { kind, nodeId, field };
  }
  return { kind, nodeId };
}

function publicAiTarget(target = {}) {
  const kind = ["draft", "project-post", "canvas"].includes(target?.kind) ? target.kind : "canvas";
  return {
    kind,
    ...(kind === "draft" && target.draftId ? { draftId: String(target.draftId) } : {}),
    ...(kind === "project-post" && target.projectId ? { projectId: String(target.projectId) } : {}),
    ...(kind === "project-post" && target.postId ? { postId: String(target.postId) } : {}),
    title: String(target?.title || ""),
    version: Number(target?.version || 0),
    includeFullContext: target?.includeFullContext === true
  };
}

function sanitizeAiValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeAiValue);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:chat|channel|message)_?id$/i.test(key)) continue;
    copy[key] = sanitizeAiValue(item);
  }
  return copy;
}

function taskInstruction(scope, documentPrompt = "") {
  if (scope.kind === "field") {
    return `Use messageAst as context. Apply block ${scope.nodeId}'s ai.prompt only to its props.${scope.field} value.`;
  }
  if (scope.kind === "block") {
    return `Use messageAst as context. Apply block ${scope.nodeId}'s ai.prompt only to that block while preserving its identity and child structure.`;
  }
  if (documentPrompt) {
    return "Use the full message AST as context. Apply task.documentPrompt across every block it explicitly addresses, including referenced following or preceding blocks. Also apply each block's ai.prompt to that block.";
  }
  return "Use the full message AST as context. For each block containing ai.prompt, apply that instruction to the editable values in its props.";
}

function aiResponseSchemaRules(ast) {
  let hasList = false;
  walkAst(ast, node => {
    if (node?.type === "list") hasList = true;
  });
  return hasList ? [
    "For list blocks, props.items must be an array of item objects. Put visible text in each item's blocks array as paragraph objects with text fields; never return string items or a top-level text field on an item."
  ] : [];
}

function normalizeAiBlockProps(type, props) {
  const copy = structuredClone(props || {});
  if (type !== "list" || !Array.isArray(copy.items)) return copy;
  copy.items = copy.items.map(item => {
    if (typeof item === "string" || typeof item === "number") {
      return { blocks: [{ type: "paragraph", text: String(item) }] };
    }
    if (!item || typeof item !== "object" || Array.isArray(item) || Array.isArray(item.blocks)) return item;
    if (!Object.prototype.hasOwnProperty.call(item, "text")) return item;
    const normalized = { ...item, blocks: [{ type: "paragraph", text: structuredClone(item.text) }] };
    delete normalized.text;
    return normalized;
  });
  return copy;
}

function findAstNode(root, nodeId) {
  let found = null;
  walkAst(root, node => {
    if (!found && String(node.id) === String(nodeId)) found = node;
  });
  return found;
}

function replaceAstNode(root, nodeId, replacement) {
  const visit = node => {
    const children = node.children || [];
    const index = children.findIndex(child => String(child.id) === String(nodeId));
    if (index >= 0) {
      children[index] = structuredClone(replacement);
      return true;
    }
    return children.some(visit);
  };
  if (!visit(root)) throw new Error(t("editor.aiDraftExchange.targetBlockNotFound"));
}

function blockShape(node) {
  return JSON.stringify({
    id: String(node?.id || ""),
    type: String(node?.type || ""),
    children: (node?.children || []).map(child => JSON.parse(blockShape(child)))
  });
}

function walkAst(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walkAst(child, fn);
}

function stripCodeFence(value) {
  const match = String(value).match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  return match ? match[1] : String(value);
}

function byteLength(value) {
  return typeof TextEncoder === "function" ? new TextEncoder().encode(String(value)).length : String(value).length;
}

function aiFileName(payload) {
  const title = String(payload?.request?.target?.title || "draft")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "draft";
  const requestId = String(payload?.request?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `${title}-ai${requestId ? `-${requestId}` : ""}.json`;
}

function requestIdFromFileName(fileName) {
  return String(fileName || "").match(/-ai-([A-Za-z0-9_-]{8,64})\.json$/i)?.[1] || "";
}

function aiRequestKey(requestId) { return `ai.request:${String(requestId || "")}`; }
function aiResponseKey(requestId) { return `ai.response:${String(requestId || "")}`; }
function aiRequestMessageKey(chatId, messageId) { return `ai.request-message:${Number(chatId || 0)}:${Number(messageId || 0)}`; }

function uniqueTelegramMessages(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const chatId = Number(item?.chatId || 0);
    const messageIds = [...(Array.isArray(item?.messageIds) ? item.messageIds : []), item?.messageId];
    for (const value of messageIds) {
      const messageId = Number(value || 0);
      const key = `${chatId}:${messageId}`;
      if (!chatId || !messageId || seen.has(key)) continue;
      seen.add(key);
      result.push({ chatId, messageId });
    }
  }
  return result;
}

function makeJsonFile(text, name) {
  if (typeof File === "function") return new File([text], name, { type: "application/json" });
  const blob = new Blob([text], { type: "application/json" });
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}
