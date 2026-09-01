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
      title: title || "Черновик",
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
      title: title || "Черновик",
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
    current.title = String(title || "").trim() || current.title || "Черновик";
    current.updatedAt = Date.now();
    await this.db?.put?.("drafts", id, current);
    this.events?.emit?.("draft:changed", { reason: "renamed", draft: structuredClone(current), draftId: id });
    return structuredClone(current);
  }

  async delete(id) {
    if (!id) return;
    await this.db?.delete?.("drafts", id);
    this.events?.emit?.("draft:changed", { reason: "deleted", draftId: id });
  }
}

function normalizeDraft(value, fallbackId = "") {
  const input = value && typeof value === "object" ? value : {};
  return {
    id: String(input.id || fallbackId || makeId()),
    title: String(input.title || "Черновик"),
    messageAst: normalizeAst(input.messageAst),
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
