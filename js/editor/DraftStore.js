import { t } from "../i18n/index.js?v=1.12.0";
const PREFIX = "draft_";

export class DraftStore {
  constructor({ db, events = null } = {}) {
    this.db = db;
    this.events = events;
  }

  async list() {
    const rows = await this.db?.all?.("drafts") || [];
    return rows
      .map(row => normalizeDraft(row.value, row.key))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  async get(id) {
    if (!id) return null;
    const value = await this.db?.get?.("drafts", id, null);
    return value ? normalizeDraft(value, id) : null;
  }

  async create({ title = "", messageAst, source = null } = {}) {
    const now = Date.now();
    const draft = normalizeDraft({
      id: makeId(),
      title: title || t("editor.draftListView.draft"),
      messageAst,
      source,
      createdAt: now,
      updatedAt: now
    });
    await this.db?.put?.("drafts", draft.id, draft);
    this.events?.emit?.("draft:changed", { reason: "created", draft: structuredClone(draft), draftId: draft.id });
    return structuredClone(draft);
  }

  async restore({ id, title = "", messageAst, source = null, createdAt = null, updatedAt = null } = {}) {
    if (!id) throw new Error("Draft id is required");
    if (await this.get(id)) throw new Error(`Draft already exists: ${id}`);
    const now = Date.now();
    const draft = normalizeDraft({
      id,
      title: title || t("editor.draftListView.draft"),
      messageAst,
      source,
      createdAt: Number(createdAt || now),
      updatedAt: Number(updatedAt || now)
    });
    await this.db?.put?.("drafts", draft.id, draft);
    this.events?.emit?.("draft:changed", { reason: "restored", draft: structuredClone(draft), draftId: draft.id });
    return structuredClone(draft);
  }

  async saveAst(id, messageAst) {
    const current = await this.get(id);
    if (!current) throw new Error(`Draft not found: ${id}`);
    current.messageAst = normalizeAst(messageAst);
    current.updatedAt = Date.now();
    await this.db?.put?.("drafts", id, current);
    this.events?.emit?.("draft:changed", { reason: "saved", draft: structuredClone(current), draftId: id });
    return structuredClone(current);
  }

  async rename(id, title) {
    const current = await this.get(id);
    if (!current) throw new Error(`Draft not found: ${id}`);
    current.title = String(title || "").trim() || current.title || t("editor.draftListView.draft");
    current.updatedAt = Date.now();
    await this.db?.put?.("drafts", id, current);
    await this.#renamePublishedSources(current);
    this.events?.emit?.("draft:changed", { reason: "renamed", draft: structuredClone(current), draftId: id });
    return structuredClone(current);
  }

  async setAiSettings(id, patch = {}) {
    const current = await this.get(id);
    if (!current) throw new Error(`Draft not found: ${id}`);
    current.ai = { ...(current.ai || {}) };
    if (Object.prototype.hasOwnProperty.call(patch, "includeFullContext")) {
      current.ai.includeFullContext = Boolean(patch.includeFullContext);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "documentPrompt")) {
      current.ai.documentPrompt = String(patch.documentPrompt || "").trim();
    }
    current.updatedAt = Date.now();
    await this.db?.put?.("drafts", id, current);
    this.events?.emit?.("draft:changed", { reason: "ai-settings", draft: structuredClone(current), draftId: id });
    return structuredClone(current);
  }

  async #renamePublishedSources(draft) {
    const rows = await this.db?.all?.("publications") || [];
    const updated = [];
    for (const row of rows) {
      const publication = row?.value;
      if (!publication?.messageId || publication.source?.kind !== "draft"
        || String(publication.source.draftId || "") !== String(draft.id)) continue;
      publication.source.title = draft.title;
      await this.db.put("publications", row.key, publication);
      updated.push(publication);
    }
    if (!updated.length) return;
    for (const publication of updated) {
      this.events?.emit?.("telegram:publication-updated", structuredClone(publication));
    }
    const publications = rows.map(row => row.value)
      .sort((a, b) => Number(b.publishedAt || b.scheduledAt || 0) - Number(a.publishedAt || a.scheduledAt || 0));
    this.events?.emit?.("telegram:publications-changed", structuredClone(publications));
  }

  async retainPublication(record) {
    if (record?.source?.kind !== "draft" || !record.source.draftId || !record.messageId) return null;
    let draft = await this.get(record.source.draftId);
    if (!draft) {
      draft = await this.restore({
        id: record.source.draftId,
        title: record.source.title,
        messageAst: record.messageAst,
        source: record.source.draftSource || null,
        createdAt: record.source.draftCreatedAt,
        updatedAt: record.source.draftUpdatedAt || record.publishedAt
      });
    }
    if (draft.source?.kind === "publication" && draft.source.publicationId !== record.id
      && await this.db.get("publications", draft.source.publicationId, null)) return null;
    if (draft.source?.retained && draft.source.publicationId === record.id) {
      if (draft.source.publicationAst) return draft;
      return this.#saveSource(draft, {
        ...draft.source,
        publicationAst: normalizeAst(record.messageAst)
      }, "publication-baseline-restored");
    }
    const originalSource = draft.source?.kind === "publication" ? draft.source.originalSource || null : draft.source;
    return this.#saveSource(draft, {
      kind: "publication",
      publicationId: record.id,
      retained: true,
      originalSource,
      chatId: record.chatId,
      messageId: record.messageId,
      targetTitle: record.target?.title || "",
      publicationAst: normalizeAst(draft.messageAst)
    }, "publication-linked");
  }

  async updatePublicationBaseline(draftId, recordId, messageAst) {
    const draft = await this.get(draftId);
    if (!draft || draft.source?.kind !== "publication" || draft.source.publicationId !== recordId) return null;
    return this.#saveSource(draft, {
      ...draft.source,
      publicationAst: normalizeAst(messageAst)
    }, "publication-baseline-updated");
  }

  async relinkPublication(recordId, { chatId, messageId, targetTitle = "" } = {}) {
    const updated = [];
    for (const draft of await this.list()) {
      if (draft.source?.kind !== "publication" || String(draft.source.publicationId) !== String(recordId)) continue;
      const next = await this.#saveSource(draft, {
        ...draft.source,
        chatId: Number(chatId || draft.source.chatId || 0) || null,
        messageId: Number(messageId || 0) || null,
        targetTitle: targetTitle || draft.source.targetTitle || ""
      }, "publication-relinked");
      updated.push(next);
    }
    return updated;
  }

  async releasePublication(recordId) {
    for (const draft of await this.list()) {
      if (draft.source?.kind !== "publication" || draft.source.publicationId !== recordId) continue;
      await this.#saveSource(draft, draft.source.originalSource || null, "publication-unlinked");
    }
  }

  async #saveSource(draft, source, reason) {
    draft.source = source ? structuredClone(source) : null;
    await this.db.put("drafts", draft.id, draft);
    this.events?.emit?.("draft:changed", { reason, draft: structuredClone(draft), draftId: draft.id });
    return structuredClone(draft);
  }

  async #hasPublishedRecord(id) {
    const rows = await this.db?.all?.("publications") || [];
    return rows.some(({ value }) => value?.messageId && value.source?.kind === "draft" && value.source.draftId === id);
  }

  async assertCanDelete(id) {
    const draft = await this.get(id);
    if ((draft?.source?.retained && draft.source.publicationId) || await this.#hasPublishedRecord(id)) {
      throw new Error(t("editor.draftListView.deletePublishedDraftBlocked"));
    }
  }

  async assertCanMoveToProject(id) {
    const draft = await this.get(id);
    if (draft?.messageAst?.children?.some(node => node?.type === "comessage")) {
      throw new Error(t("editor.draftListView.comessageProjectBlocked"));
    }
    if ((draft?.source?.kind === "publication" && draft.source.publicationId) || await this.#hasPublishedRecord(id)) {
      throw new Error(t("editor.draftListView.movePublishedDraftBlocked"));
    }
  }

  async delete(id) {
    if (!id) return;
    await this.assertCanDelete(id);
    const runtimeRows = await this.db?.all?.("runtime") || [];
    const entries = [
      { store: "drafts", key: id },
      ...draftAiRequestEntries(runtimeRows, id)
    ];
    await deleteDatabaseEntries(this.db, entries);
    this.events?.emit?.("draft:changed", { reason: "deleted", draftId: id });
  }

  async cleanupOrphanedAiRequests() {
    if (!this.db?.all) return 0;
    const [runtimeRows, draftRows] = await Promise.all([
      this.db.all("runtime"),
      this.db.all("drafts")
    ]);
    const draftIds = new Set(draftRows.map(row => String(row.key)));
    const entries = runtimeRows
      .filter(isDraftAiRequestRow)
      .filter(row => !draftIds.has(String(row.value.target.draftId)))
      .map(row => ({ store: "runtime", key: row.key }));
    await deleteDatabaseEntries(this.db, entries);
    return entries.length;
  }
}

function draftAiRequestEntries(rows, draftId) {
  const id = String(draftId);
  return rows
    .filter(isDraftAiRequestRow)
    .filter(row => String(row.value.target.draftId) === id)
    .map(row => ({ store: "runtime", key: row.key }));
}

function isDraftAiRequestRow(row) {
  return String(row?.key || "").startsWith("ai.request:")
    && row?.value?.target?.kind === "draft"
    && String(row.value.target.draftId || "").length > 0;
}

async function deleteDatabaseEntries(db, entries) {
  if (!entries.length || !db) return;
  if (db.deleteMany) {
    await db.deleteMany(entries);
    return;
  }
  for (const { store, key } of entries) await db.delete?.(store, key);
}

function normalizeDraft(value, fallbackId = "") {
  const input = value && typeof value === "object" ? value : {};
  return {
    id: String(input.id || fallbackId || makeId()),
    title: String(input.title || t("editor.draftListView.draft")),
    messageAst: normalizeAst(input.messageAst),
    ai: {
      includeFullContext: input.ai?.includeFullContext === true,
      documentPrompt: String(input.ai?.documentPrompt || "")
    },
    source: input.source && typeof input.source === "object" ? structuredClone(input.source) : null,
    createdAt: Number(input.createdAt || Date.now()),
    updatedAt: Number(input.updatedAt || input.createdAt || Date.now())
  };
}

function normalizeAst(ast) {
  const value = ast && typeof ast === "object" ? structuredClone(ast) : { id: "root", type: "document", props: {}, children: [] };
  value.id = "root";
  value.type ||= "document";
  value.props ||= {};
  value.children = stripProjectNodes(Array.isArray(value.children) ? value.children : []);
  return value;
}

export function hasUnappliedDraftPublicationChanges(draft, record = null) {
  if (draft?.source?.kind !== "publication" || !draft.source.publicationId) return false;
  const baseline = draft.source.publicationAst || record?.messageAst;
  if (!baseline) return false;
  return stableSnapshot(normalizeAst(draft.messageAst)) !== stableSnapshot(normalizeAst(baseline));
}

function stableSnapshot(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    output[key] = canonicalize(item);
  }
  return output;
}

function stripProjectNodes(nodes) {
  const out = [];
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    if (["project_post_map", "project_map_backlink"].includes(node.type)) continue;
    const copy = structuredClone(node);
    copy.children = stripProjectNodes(Array.isArray(copy.children) ? copy.children : []);
    out.push(copy);
  }
  return out;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return `${PREFIX}${crypto.randomUUID()}`;
  return `${PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
