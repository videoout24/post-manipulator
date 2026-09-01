import { t } from "../i18n/index.js?v=1.8.0";
import { linkTargetKey } from "./LinkTarget.js?v=1.5.9";

// Target cards intentionally do not mutate relations.  Their green ↙ is a
// shortcut to the document that owns the linked fragment, where the author
// can inspect or remove the relation next to the actual text.
export class LinkRelationNavigator {
  constructor({ events, linkRelations, documents, publications, navigation, controller } = {}) {
    Object.assign(this, { events, linkRelations, documents, publications, navigation, controller });
    this.unsubscribe = null;
  }

  start() {
    this.unsubscribe = this.events?.on?.("links:open-linked-source-requested", target => {
      this.openTarget(target).catch(error => this.#report(error));
    });
    return this;
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async openTarget(target) {
    const relation = await this.#latestRelationForTarget(target);
    if (!relation) throw new Error(t("links.linkRelationNavigator.connectionForThisCardIsNoLonger"));
    return this.openRelation(relation);
  }

  async openRelation(relation) {
    const source = relation?.source || {};
    if (source.kind === "draft") {
      if (!this.documents?.openDraft) throw new Error(t("links.linkRelationNavigator.editorCannotOpenDraftSource"));
      await this.documents.openDraft(source.id);
    } else if (source.kind === "project_post") {
      const address = projectPostAddress(source);
      if (!address) throw new Error(t("links.linkRelationNavigator.failedToDetermineProjectPostSourceOf"));
      if (!this.documents?.openProjectPost) throw new Error(t("links.linkRelationNavigator.editorCannotOpenProjectPostSource"));
      await this.documents.openProjectPost(address.projectId, address.postId);
    } else if (source.kind === "publication") {
      const draft = await this.publications?.createEditDraft?.(source.id);
      if (!draft) throw new Error(t("links.linkRelationNavigator.failedToOpenPublicationSourceOfConnection"));
      await this.events?.emitAsync?.("publication:edit-draft-requested", draft);
    } else if (source.kind === "editor") {
      if (!this.controller?.tree?.find?.(source.nodeId)) {
        throw new Error(t("links.linkRelationNavigator.originalMessageIsAvailableOnlyInThe"));
      }
    } else {
      throw new Error(t("links.linkRelationNavigator.typeOfConnectionSourceIsNotSupported"));
    }

    this.navigation?.activateTab?.("editor");
    const focused = this.#focusSourceNode(relation);
    this.events?.emit?.("links:source-opened", { relation: structuredClone(relation), focused });
    return relation;
  }

  async #latestRelationForTarget(target) {
    const targetKey = linkTargetKey(target);
    if (!targetKey) return null;
    const relations = await this.linkRelations?.list?.() || [];
    return relations
      .filter(relation => linkTargetKey(relation?.target) === targetKey)
      .sort(compareRelationRecency)
      .at(-1) || null;
  }

  #focusSourceNode(relation) {
    const nodeId = String(relation?.source?.nodeId || "");
    if (!nodeId || !this.controller?.tree?.find?.(nodeId)) return false;
    this.controller.select?.(nodeId);
    return true;
  }

  #report(error) {
    this.events?.emit?.("ui:toast", {
      message: t("links.linkRelationNavigator.connection", { 0: error?.message || error }),
      type: "error"
    });
  }
}

export function projectPostAddress(source = {}) {
  const projectId = String(source.projectId || "").trim();
  const postId = String(source.postId || "").trim();
  if (projectId && postId) return { projectId, postId };

  // Older relations predate explicit projectId/postId fields. Their stable
  // compound id is kept readable so those relations remain navigable.
  const raw = String(source.id || "");
  const divider = raw.indexOf(":");
  if (divider <= 0 || divider === raw.length - 1) return null;
  return { projectId: raw.slice(0, divider), postId: raw.slice(divider + 1) };
}

function compareRelationRecency(left, right) {
  const a = Number(left?.updatedAt || left?.createdAt || 0);
  const b = Number(right?.updatedAt || right?.createdAt || 0);
  return a - b || String(left?.id || "").localeCompare(String(right?.id || ""));
}
