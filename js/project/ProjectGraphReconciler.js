import { t } from "../i18n/index.js?v=1.8.0";
import { randomUUID } from "../core/Random.js?v=1.5.9";
import { firstHeadingText } from "./ProjectPostHeading.js?v=1.5.9";

const RECONCILE_REASONS = new Set([
  "post-saved",
  "post-created",
  "post-deleted",
  "post-renamed",
  "backlink-rebound",
  "saved"
]);

/*
  Keeps Project graph relations canonical.

  A Post Map owns the forward relation (slot.targetPostId). Backlinks and the visible
  slot label derived from the target Heading are projections of that relation and are
  maintained automatically here. A manual Back to Map reserves the pair (post,map):
  the same post cannot also be attached to a slot of that Map, because that would
  require a second backlink to the same Map. Backlinks to other Maps remain valid.
*/
export class ProjectGraphReconciler {
  constructor({ store, events = null, delay = 35 } = {}) {
    if (!store) throw new Error("ProjectGraphReconciler requires ProjectStore");
    this.store = store;
    this.events = events;
    this.delay = delay;
    this.timers = new Map();
    this.running = new Map();
    this.resync = new Set();
    this.off = null;
  }

  start() {
    if (this.off || !this.events?.on) return;
    this.off = this.events.on("project:changed", event => {
      if (!RECONCILE_REASONS.has(event?.reason) || !event?.projectId) return;
      if (event.reason === "post-saved" && event.graphRelevantChanged !== true) return;
      this.schedule(event.projectId);
    });
  }

  stop() {
    this.off?.();
    this.off = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  schedule(projectId, { delay = this.delay } = {}) {
    if (!projectId) return;
    clearTimeout(this.timers.get(projectId));
    if (this.running.has(projectId)) {
      this.resync.add(projectId);
      return;
    }
    this.timers.set(projectId, setTimeout(() => {
      this.timers.delete(projectId);
      this.reconcile(projectId).catch(error => {
        this.events?.emit("project:graph-error", { projectId, error, message: error?.message || String(error) });
      });
    }, Math.max(0, Number(delay) || 0)));
  }

  reconcile(projectId) {
    if (!projectId) return Promise.reject(new Error(t("project.common.projectIdRequired")));
    if (this.running.has(projectId)) {
      this.resync.add(projectId);
      return this.running.get(projectId);
    }
    const promise = this.#run(projectId).finally(() => {
      this.running.delete(projectId);
      this.resync.delete(projectId);
    });
    this.running.set(projectId, promise);
    return promise;
  }

  async #run(projectId) {
    let result = null;
    do {
      this.resync.delete(projectId);
      const affectedPostIds = new Set();
      result = await this.store.updateProject(projectId, draft => {
        const changed = reconcileProjectDraft(draft, { changedPostIds: affectedPostIds });
        return changed ? true : false;
      }, "graph-reconciled", () => ({ affectedPostIds: [...affectedPostIds] }));
    } while (this.resync.has(projectId));
    return result;
  }
}

export function reconcileProjectDraft(project, { changedPostIds = null } = {}) {
  if (!project || !Array.isArray(project.posts)) return false;
  const beforeAst = changedPostIds instanceof Set
    ? new Map(project.posts.map(post => [String(post.id), stableAst(post.messageAst)]))
    : null;
  let changed = false;
  const posts = new Map(project.posts.map(post => [String(post.id), post]));
  const manualBacklinks = new Map(project.posts.map(post => [String(post.id), manualBacklinkTargets(post.messageAst)]));
  const desiredBacklinks = new Map();

  for (const hostPost of project.posts) {
    walk(hostPost.messageAst, node => {
      if (node.type !== "project_post_map") return;
      const mapId = clean(node.props?.mapId);
      if (!mapId) return;
      const slots = Array.isArray(node.props?.slots) ? node.props.slots : [];
      const usedTargets = new Set();

      for (const slot of slots) {
        const targetPostId = clean(slot?.targetPostId);
        if (!targetPostId) {
          // Preserve manual text on a never-linked empty slot. If the text was derived
          // from a former target, unlinking releases it back to the generated prefix.
          if (slot?.derivedFromPostId) {
            if (String(slot?.text || "") !== "") slot.text = "";
            delete slot.derivedFromPostId;
            changed = true;
          }
          continue;
        }

        const targetAlreadyHasManualBacklink = manualBacklinks.get(targetPostId)?.has(mapId) === true;
        const invalidTarget = !posts.has(targetPostId)
          || targetPostId === String(hostPost.id)
          || usedTargets.has(targetPostId)
          || targetAlreadyHasManualBacklink;
        if (invalidTarget) {
          slot.targetPostId = null;
          if (String(slot?.text || "") !== "") slot.text = "";
          if (slot?.derivedFromPostId) delete slot.derivedFromPostId;
          changed = true;
          continue;
        }

        usedTargets.add(targetPostId);
        const targetPost = posts.get(targetPostId);
        const heading = firstHeadingText(targetPost?.messageAst);
        if (String(slot?.text || "") !== heading) {
          slot.text = heading;
          changed = true;
        }
        if (String(slot?.derivedFromPostId || "") !== targetPostId) {
          slot.derivedFromPostId = targetPostId;
          changed = true;
        }
        if (!desiredBacklinks.has(targetPostId)) desiredBacklinks.set(targetPostId, new Map());
        desiredBacklinks.get(targetPostId).set(mapId, clean(slot?.id));
      }
    });
  }

  for (const post of project.posts) {
    const desired = desiredBacklinks.get(String(post.id)) || new Map();
    const kept = new Set();
    if (removeInvalidManagedBacklinks(post.messageAst, desired, kept)) changed = true;

    post.messageAst ||= { id: "root", type: "document", props: {}, children: [] };
    post.messageAst.children ||= [];
    for (const [mapId, slotId] of desired) {
      if (kept.has(mapId)) continue;
      // A manual backlink to the same map blocks the slot relation above, so reaching
      // this branch means the (post,map) pair is free for one managed backlink.
      post.messageAst.children.push({
        id: randomUUID(),
        type: "project_map_backlink",
        props: {
          targetMapId: mapId,
          targetSlotId: slotId || null,
          text: t("core.propertyRegistry.back"),
          managedByMap: true
        },
        children: []
      });
      changed = true;
    }
  }

  if (beforeAst && changedPostIds instanceof Set) {
    for (const post of project.posts) {
      const id = String(post.id);
      if (beforeAst.get(id) !== stableAst(post.messageAst)) changedPostIds.add(id);
    }
  }
  return changed;
}

function removeInvalidManagedBacklinks(node, desired, kept) {
  if (!node || typeof node !== "object" || !Array.isArray(node.children)) return false;
  let changed = false;
  const next = [];
  for (const child of node.children) {
    const managed = child?.type === "project_map_backlink" && child?.props?.managedByMap === true;
    if (managed) {
      const mapId = clean(child.props?.targetMapId);
      if (!mapId || !desired.has(mapId) || kept.has(mapId)) {
        changed = true;
        continue;
      }
      const desiredSlotId = clean(desired.get(mapId));
      if (clean(child.props?.targetSlotId) !== desiredSlotId) {
        child.props ||= {};
        if (desiredSlotId) child.props.targetSlotId = desiredSlotId;
        else delete child.props.targetSlotId;
        changed = true;
      }
      kept.add(mapId);
    }
    if (removeInvalidManagedBacklinks(child, desired, kept)) changed = true;
    next.push(child);
  }
  if (changed) node.children = next;
  return changed;
}

function manualBacklinkTargets(ast) {
  const targets = new Set();
  walk(ast, node => {
    if (node?.type !== "project_map_backlink" || node?.props?.managedByMap === true) return;
    const mapId = clean(node.props?.targetMapId);
    if (mapId) targets.add(mapId);
  });
  return targets;
}

export { firstHeadingText };

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walk(child, fn);
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function stableAst(ast) {
  try { return JSON.stringify(ast || null); }
  catch { return String(ast); }
}
