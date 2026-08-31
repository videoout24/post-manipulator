import { randomUUID } from "../core/Random.js?v=1.5.9";
import { telegramMessageUrl } from "../project/ProjectDeploymentResolver.js?v=1.5.9";
import { materializeRelationUrl, relationIdsInAst } from "./LinkRelationAst.js?v=1.5.9";

export const LINK_RELATION_STATUS = Object.freeze({
  PENDING: "pending",
  RESOLVED: "resolved",
  APPLIED: "applied",
  FAILED: "failed"
});

export class LinkRelationStore {
  constructor({ db, events = null } = {}) { this.db = db; this.events = events; }

  async create({ source, target, label = "" } = {}) {
    validateEndpoint(source, "источник");
    validateEndpoint(target, "цель");
    const relation = {
      id: `link_${randomUUID()}`,
      source: structuredClone(source),
      target: structuredClone(target),
      label: String(label || ""),
      status: LINK_RELATION_STATUS.PENDING,
      resolvedUrl: "",
      error: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      resolvedAt: null,
      appliedAt: null
    };
    const url = await this.resolveTargetUrl(relation.target);
    if (url) applyResolved(relation, url);
    await this.db.put("link_relations", relation.id, relation);
    this.events?.emit("links:changed", { reason: "created", relation: structuredClone(relation) });
    return relation;
  }

  get(id) { return this.db.get("link_relations", id, null); }
  async list() { return (await this.db.all("link_relations")).map(row => row.value); }

  async resolveTargetUrl(target) {
    if (target?.kind === "external") return String(target.url || "").trim();
    const publication = await this.#publicationForTarget(target);
    return publication?.chatId && publication?.messageId
      ? telegramMessageUrl(publication.chatId, publication.messageId)
      : "";
  }

  async resolveWaitingForPublication(publicationOrId) {
    const publication = typeof publicationOrId === "object"
      ? publicationOrId
      : await this.db.get("publications", publicationOrId, null);
    if (!publication) return [];
    if (!publication.id && typeof publicationOrId !== "object") publication.id = String(publicationOrId);
    const relations = await this.list();
    const changed = [];
    for (const relation of relations) {
      if (!targetMatchesPublication(relation.target, publication)) continue;
      if (relation.target?.kind === "draft") {
        relation.target = {
          ...relation.target,
          kind: "publication",
          id: String(publication.id),
          title: relation.target.title || publication.source?.title || "Публикация"
        };
      }
      const url = await this.resolveTargetUrl(relation.target);
      if (!url || relation.resolvedUrl === url) continue;
      applyResolved(relation, url);
      await this.db.put("link_relations", relation.id, relation);
      changed.push(structuredClone(relation));
    }
    if (changed.length) this.events?.emit("links:changed", { reason: "targets-resolved", relations: changed });
    return changed;
  }

  async bindSourceDraftToPublication(draftId, publicationId) {
    if (!draftId || !publicationId) return [];
    const changed = [];
    for (const relation of await this.list()) {
      if (relation.source?.kind !== "draft" || String(relation.source.id) !== String(draftId)) continue;
      relation.source = { ...relation.source, kind: "publication", id: String(publicationId) };
      relation.updatedAt = Date.now();
      await this.db.put("link_relations", relation.id, relation);
      changed.push(structuredClone(relation));
    }
    if (changed.length) this.events?.emit("links:changed", { reason: "sources-published", relations: changed });
    return changed;
  }

  async materializeAst(ast) {
    let next = structuredClone(ast);
    for (const relationId of relationIdsInAst(next)) {
      const relation = await this.get(relationId);
      // An orphaned marker must never keep an old external URL after its
      // relation was removed. It renders as ordinary text until re-linked.
      next = materializeRelationUrl(next, relationId, relation?.resolvedUrl || "");
    }
    return next;
  }

  async reconcileSource(source, ast) {
    if (!source?.kind || !source?.id) return [];
    const present = new Set(relationIdsInAst(ast));
    const removed = [];
    for (const relation of await this.list()) {
      if (relation.source?.kind !== source.kind || String(relation.source?.id) !== String(source.id)) continue;
      if (present.has(String(relation.id))) continue;
      await this.remove(relation.id);
      removed.push(relation.id);
    }
    return removed;
  }

  async markApplied(id) {
    const relation = await this.get(id);
    if (!relation) return null;
    relation.status = LINK_RELATION_STATUS.APPLIED;
    relation.appliedAt = relation.updatedAt = Date.now();
    relation.error = "";
    await this.db.put("link_relations", id, relation);
    this.events?.emit("links:changed", { reason: "applied", relation: structuredClone(relation) });
    return relation;
  }

  async markFailed(id, error) {
    const relation = await this.get(id);
    if (!relation) return null;
    relation.status = LINK_RELATION_STATUS.FAILED;
    relation.error = String(error?.message || error || "Не удалось обновить ссылку");
    relation.updatedAt = Date.now();
    await this.db.put("link_relations", id, relation);
    this.events?.emit("links:changed", { reason: "failed", relation: structuredClone(relation) });
    return relation;
  }

  async remove(id) {
    const relation = await this.get(id);
    await this.db.delete("link_relations", id);
    this.events?.emit("links:changed", { reason: "removed", id, relation: relation ? structuredClone(relation) : null });
    return relation;
  }

  async #publicationForTarget(target) {
    if (!target?.id) return null;
    if (target.kind === "publication") return this.db.get("publications", target.id, null);
    if (target.kind !== "draft") return null;
    const rows = await this.db.all("publications");
    return rows.map(row => row.value).find(record => String(record?.source?.draftId || "") === String(target.id)) || null;
  }
}

function validateEndpoint(value, label) {
  if (!value?.kind) throw new Error(`Не указан ${label} связи`);
  if (value.kind === "external" ? !value.url : !value.id) throw new Error(`Не указан идентификатор: ${label}`);
}

function applyResolved(relation, url) {
  relation.resolvedUrl = String(url);
  relation.status = LINK_RELATION_STATUS.RESOLVED;
  relation.error = "";
  relation.resolvedAt = relation.updatedAt = Date.now();
}

function targetMatchesPublication(target, publication) {
  if (!target || !publication) return false;
  if (target.kind === "publication") return String(target.id) === String(publication.id);
  if (target.kind === "draft") return String(target.id) === String(publication.source?.draftId || "");
  return false;
}
