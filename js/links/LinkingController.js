import { replaceRichTextRange, richTextToPlain, sliceRichText } from "../core/RichText.js?v=1.5.9";
import { findLinkRelationAtRange, unwrapLinkRelation } from "./LinkRelationAst.js?v=1.5.9";
import { internalLinkUrl, linkTargetKey, normalizeLinkTarget, sameLinkTarget } from "./LinkTarget.js?v=1.5.9";

// Link creation intentionally has no modal or transient "selection mode". A
// single target lives in this controller's slot. Cards toggle the slot; the
// text or block button consumes it immediately.
export class LinkingController {
  constructor({ events, tree, controller, linkRelations, draftSession = null, projectSession = null, confirmFn = globalThis.confirm } = {}) {
    Object.assign(this, { events, tree, controller, linkRelations, draftSession, projectSession, confirmFn });
    this.confirm = typeof confirmFn === "function" ? message => Reflect.apply(confirmFn, globalThis, [message]) : null;
    this.targetSlot = null;
    this.relations = new Map();
    this.unsubscribe = [];
    this.refreshRevision = 0;
    this.reconcileTimer = null;
  }

  start() {
    this.unsubscribe.push(
      this.events?.on?.("links:target-selected", target => this.toggleTarget(target).catch(error => this.#report(error))),
      this.events?.on?.("links:open-linked-source-requested", () => this.clearTargetSlot()),
      this.events?.on?.("links:select-target-requested", request => this.attachInline(request?.source || request).catch(error => this.#report(error))),
      this.events?.on?.("links:block-target-requested", source => this.attachBlock(source).catch(error => this.#report(error))),
      this.events?.on?.("links:state-requested", () => this.#emitState()),
      this.events?.on?.("links:changed", () => this.refreshRelations().catch(error => this.#report(error))),
      this.events?.on?.("tree:changed", () => this.scheduleReconcile())
    );
    this.refreshRelations().catch(error => this.#report(error));
    this.#emitSlot();
    return this;
  }

  stop() {
    clearTimeout(this.reconcileTimer);
    for (const off of this.unsubscribe.splice(0)) off?.();
  }

  scheduleReconcile() {
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => this.reconcileCurrentTree().catch(error => this.#report(error)), 250);
  }

  async reconcileCurrentTree() {
    const source = this.#sourceDocument({});
    const ast = this.tree?.toJSON?.() || this.tree?.root;
    if (!ast) return [];
    return this.linkRelations.reconcileSource?.(source, ast) || [];
  }

  getTargetSlot() { return this.targetSlot ? structuredClone(this.targetSlot) : null; }

  clearTargetSlot() {
    if (!this.targetSlot) return false;
    this.targetSlot = null;
    this.#emitSlot();
    return true;
  }

  async toggleTarget(rawTarget) {
    const target = normalizeLinkTarget(rawTarget);
    if (!target) throw new Error("Не удалось определить цель ссылки");

    // Only idle/yellow cards dispatch this event. A green card opens its source
    // through LinkRelationNavigator and must never change or delete the slot.
    if (sameLinkTarget(this.targetSlot, target)) {
      this.targetSlot = null;
      this.#emitSlot();
      return null;
    }
    this.targetSlot = target;
    this.#emitSlot();
    return this.getTargetSlot();
  }

  async attachInline(source = {}) {
    const node = this.#sourceNode(source);
    const property = String(source.property || "text");
    const current = node.props?.[property] ?? "";
    const start = Number(source.start ?? 0);
    const end = Number(source.end ?? start);
    const existing = findLinkRelationAtRange(current, start, end);
    if (end <= start && !existing) throw new Error("Выделите текст, который нужно связать");
    if (existing) {
      const removed = await this.detachRelation(existing.relationId, { notify: true, confirm: true });
      if (!removed) return { cancelled: true, relationId: existing.relationId };
      this.events?.emit?.("links:source-unlinked", { relationId: existing.relationId, source });
      return { removed: existing.relationId };
    }
    const sourceDocument = this.#sourceDocument({ ...source, property, nodeId: node.id, mode: "inline" });
    const target = this.#requireTarget(sourceDocument);
    const selected = sliceRichText(current, start, end);
    const label = String(source.text || richTextToPlain(selected) || "").trim();
    const relation = await this.linkRelations.create({
      source: sourceDocument,
      target,
      label
    });
    const marker = {
      type: "link_relation",
      relation_id: relation.id,
      text: selected,
      url: relation.resolvedUrl || "",
      target_title: target.title,
      target_kind: target.kind
    };
    const next = replaceRichTextRange(current, start, end, marker);
    this.controller.updateNodeProperty(node.id, property, next, { inspectorSource: false });
    this.#consumeTarget();
    this.events?.emit?.("links:created", { relation, source });
    return relation;
  }

  async attachBlock(source = {}) {
    const node = this.#sourceNode(source);
    const existingId = String(node.props?.relationId || "");
    if (existingId) {
      const removed = await this.detachRelation(existingId, { notify: true, confirm: true });
      if (!removed) return { cancelled: true, relationId: existingId };
      this.events?.emit?.("links:source-unlinked", { relationId: existingId, source });
      return { removed: existingId };
    }
    const sourceDocument = this.#sourceDocument({ ...source, nodeId: node.id, property: "url", mode: "block" });
    const target = this.#requireTarget(sourceDocument);
    const relation = await this.linkRelations.create({
      source: sourceDocument,
      target,
      label: String(source.text || node.props?.text || "").trim()
    });
    this.controller.updateNodeProperties(node.id, {
      relationId: relation.id,
      relationTargetTitle: target.title,
      relationTargetKind: target.kind,
      url: relation.resolvedUrl || internalLinkUrl(relation.id)
    }, { inspectorSource: false });
    this.#consumeTarget();
    this.events?.emit?.("links:created", { relation, source });
    return relation;
  }

  async detachRelation(id, { notify = true, confirm = false } = {}) {
    if (!id) return false;
    const relation = this.relations.get(String(id)) || await this.linkRelations.get?.(id) || null;
    if (confirm && this.confirm?.(`Разорвать связь${relation?.label ? ` «${relation.label}»` : ""}?`) === false) return false;
    this.#clearRelationFromCurrentTree(relation, id);
    await this.linkRelations.remove?.(id);
    this.relations.delete(String(id));
    if (notify) {
      this.#emitRelations();
      this.events?.emit?.("links:removed", { id: String(id), relation });
    }
    return true;
  }

  async refreshRelations() {
    const revision = ++this.refreshRevision;
    const rows = await this.linkRelations.list?.() || [];
    if (revision !== this.refreshRevision) return;
    this.relations = new Map(rows.filter(item => item?.id).map(item => [String(item.id), structuredClone(item)]));
    this.#syncActiveBlockUrls();
    this.#emitRelations();
  }

  #sourceNode(source) {
    const node = this.tree?.find?.(source?.nodeId);
    if (!node) throw new Error("Исходный текст больше не найден");
    return node;
  }

  #requireTarget(source = this.#sourceDocument({})) {
    if (!this.targetSlot) throw new Error("Сначала выберите цель кнопкой ↙");
    const target = structuredClone(this.targetSlot);
    if (this.#isSelfTarget(target, source)) throw new Error("Нельзя связать сообщение с самим собой");
    return target;
  }

  #consumeTarget() {
    this.targetSlot = null;
    this.#emitSlot();
  }

  #sourceDocument(source = {}) {
    if (this.draftSession?.activeDraftId) {
      const publicationId = this.draftSession?.draft?.source?.kind === "publication"
        ? this.draftSession.draft.source.publicationId
        : null;
      return compactObject({
        kind: publicationId ? "publication" : "draft",
        id: publicationId || this.draftSession.activeDraftId,
        nodeId: source.nodeId || null,
        property: source.property || null,
        mode: source.mode || null
      });
    }
    if (this.projectSession?.activeProjectId && this.projectSession?.activePostId) {
      return compactObject({
        kind: "project_post",
        id: `${this.projectSession.activeProjectId}:${this.projectSession.activePostId}`,
        projectId: this.projectSession.activeProjectId,
        postId: this.projectSession.activePostId,
        nodeId: source.nodeId || null,
        property: source.property || null,
        mode: source.mode || null
      });
    }
    return compactObject({ kind: "editor", id: "active", nodeId: source.nodeId || null, property: source.property || null, mode: source.mode || null });
  }

  #isSelfTarget(target, source = this.#sourceDocument({})) {
    return sameLinkTarget(source, target);
  }

  #clearRelationFromCurrentTree(relation, id) {
    const nodeId = relation?.source?.nodeId;
    const node = nodeId ? this.tree?.find?.(nodeId) : null;
    if (!node) return false;
    if (String(node.props?.relationId || "") === String(id)) {
      this.controller.updateNodeProperties(node.id, clearBlockRelationProps(), { inspectorSource: false });
      return true;
    }
    const property = String(relation?.source?.property || "");
    if (!property || !(property in (node.props || {}))) return false;
    const current = node.props[property];
    const next = unwrapLinkRelation(current, id);
    if (next === current) return false;
    this.controller.updateNodeProperty(node.id, property, next, { inspectorSource: false });
    return true;
  }

  #syncActiveBlockUrls() {
    this.tree?.walk?.(node => {
      const relationId = String(node?.props?.relationId || "");
      if (!relationId) return;
      const relation = this.relations.get(relationId);
      if (!relation) return;
      const url = relation.resolvedUrl || internalLinkUrl(relationId);
      if (String(node.props?.url || "") === url) return;
      this.controller.updateNodeProperty(node.id, "url", url, { inspectorSource: false });
    });
  }

  #emitSlot() {
    this.events?.emit?.("links:target-slot-changed", {
      active: Boolean(this.targetSlot),
      target: this.getTargetSlot(),
      targetKey: linkTargetKey(this.targetSlot)
    });
  }

  #emitRelations() {
    const linkedTargets = {};
    for (const relation of this.relations.values()) {
      const key = linkTargetKey(relation.target);
      if (!key) continue;
      const entry = linkedTargets[key] ||= {
        count: 0,
        target: structuredClone(relation.target),
        latestRelationId: relation.id,
        latestUpdatedAt: 0
      };
      entry.count += 1;
      const updatedAt = Number(relation.updatedAt || relation.createdAt || 0);
      if (updatedAt >= entry.latestUpdatedAt) {
        entry.latestRelationId = relation.id;
        entry.latestUpdatedAt = updatedAt;
      }
    }
    this.events?.emit?.("links:relation-targets-changed", { linkedTargets });
  }

  #emitState() {
    this.#emitSlot();
    this.#emitRelations();
  }

  #report(error) {
    this.events?.emit?.("ui:toast", { message: `Связь: ${error?.message || error}`, type: "error" });
  }
}

function clearBlockRelationProps() {
  return {
    relationId: "",
    relationTargetTitle: "",
    relationTargetKind: "",
    url: ""
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}
