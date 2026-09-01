import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { BlockTree } from "../core/BlockTree.js?v=1.5.9";
import { getProjectRootMap, getProjectRootPost, isLinearProject } from "./ProjectStore.js?v=1.7.6";

export class ProjectValidator {
  constructor({ richMessageValidator = null } = {}) { this.richMessageValidator = richMessageValidator; }

  validate(project, index = new ProjectIndex(project)) {
    const errors = [];
    if (!project?.id) errors.push(error("project.id", "Project id отсутствует"));
    const postIds = new Set();
    for (const post of project?.posts || []) {
      if (this.richMessageValidator && post?.messageAst) {
        for (const item of this.richMessageValidator.validate(new BlockTree(post.messageAst))) {
          errors.push(error("post.ast", item.message || String(item), { postId: post.id, validation: item }));
        }
      }
      if (!post?.id) errors.push(error("post.id", "У поста отсутствует stable id"));
      else if (postIds.has(post.id)) errors.push(error("post.id", `Дублирующий postId: ${post.id}`, { postId: post.id }));
      else postIds.add(post.id);
    }

    for (const duplicate of index.duplicates || []) {
      errors.push(error(`project.${duplicate.kind}`, `Дублирующий ${duplicate.kind}: ${duplicate.id}`, duplicate));
    }

    if (isLinearProject(project)) {
      const rootPost = getProjectRootPost(project);
      const rootMap = getProjectRootMap(project);
      const rootMapId = string(rootMap?.props?.mapId);
      if (!rootPost) {
        errors.push(error("project.rootPost", "В проекте отсутствует первый пост"));
      } else if (!hasNode(rootPost.messageAst, node => node?.type === "heading")) {
        errors.push(error("project.requiredHeading", "В первом посте обязателен заголовок", { postId: rootPost.id }));
      }
      if (!rootMap || !rootMapId) {
        errors.push(error("project.requiredMap", "В первом посте обязательна карта проекта", { postId: rootPost?.id || null }));
      }

      for (const post of project?.posts || []) {
        if (!hasNode(post.messageAst, node => node?.type === "heading")) {
          errors.push(error("project.requiredHeading", "В каждом посте обязателен заголовок", { postId: post.id }));
        }
        if (rootPost && String(post.id) !== String(rootPost.id) && rootMapId
          && !hasNode(post.messageAst, node => node?.type === "project_map_backlink" && string(node.props?.targetMapId) === rootMapId)) {
          errors.push(error("project.requiredBacklink", "В каждом посте обязателен блок «Назад к карте»", { postId: post.id, targetMapId: rootMapId }));
        }
      }
    }

    const mapIds = new Set(index.mapToHostPost.keys());
    const mapSlots = collectMapSlots(project);
    const manualBacklinks = new Map((project?.posts || []).map(post => [String(post.id), manualBacklinkTargets(post.messageAst)]));

    for (const post of project?.posts || []) {
      const usedBacklinkMaps = new Set();
      walk(post.messageAst, node => {
        if (node.type === "project_post_map") {
          const mapId = string(node.props?.mapId);
          if (!mapId) errors.push(error("map.mapId", "Post Map не имеет mapId", { postId: post.id, nodeId: node.id }));
          const usedTargets = new Set();
          for (const slot of Array.isArray(node.props?.slots) ? node.props.slots : []) {
            if (!string(slot?.id)) errors.push(error("map.slotId", "Map slot не имеет slotId", { postId: post.id, nodeId: node.id }));
            const target = string(slot?.targetPostId);
            if (target && !postIds.has(target)) errors.push(error("map.targetPostId", `Map slot ссылается на отсутствующий postId: ${target}`, { postId: post.id, nodeId: node.id, targetPostId: target }));
            if (target && target === post.id) errors.push(error("map.selfTarget", "Post Map не может ссылаться на пост-контейнер этой же Map", { postId: post.id, nodeId: node.id, targetPostId: target }));
            if (target && usedTargets.has(target)) errors.push(error("map.duplicateTarget", `Один postId нельзя назначить двум слотам одной Map: ${target}`, { postId: post.id, nodeId: node.id, targetPostId: target }));
            if (target && mapId && manualBacklinks.get(target)?.has(mapId)) {
              errors.push(error("map.targetBacklinkConflict", "Пост уже содержит ручной Back to Map на эту Map и не может быть привязан её слотом повторно", { postId: post.id, nodeId: node.id, targetPostId: target, targetMapId: mapId }));
            }
            if (target) usedTargets.add(target);
          }
        }
        if (node.type === "project_map_backlink") {
          const targetMapId = string(node.props?.targetMapId);
          if (!targetMapId) errors.push(error("backlink.targetMapId", "Back to Map не выбрал целевую Map", { postId: post.id, nodeId: node.id }));
          else {
            if (!mapIds.has(targetMapId)) errors.push(error("backlink.targetMapId", `Back to Map ссылается на отсутствующую Map: ${targetMapId}`, { postId: post.id, nodeId: node.id, targetMapId }));
            if (usedBacklinkMaps.has(targetMapId)) errors.push(error("backlink.duplicateMap", "В одном посте может быть только один Back to Map на конкретную Map", { postId: post.id, nodeId: node.id, targetMapId }));
            if (node.props?.managedByMap === true) {
              const targetSlotId = string(node.props?.targetSlotId);
              if (!targetSlotId) {
                errors.push(error("backlink.targetSlotId", "Managed Back to Map не выбрал целевой Slot", { postId: post.id, nodeId: node.id, targetMapId }));
              } else {
                const relation = mapSlots.get(targetMapId)?.get(targetSlotId);
                if (!relation) errors.push(error("backlink.targetSlotId", `Back to Map ссылается на отсутствующий Slot: ${targetSlotId}`, { postId: post.id, nodeId: node.id, targetMapId, targetSlotId }));
                else if (string(relation.targetPostId) !== string(post.id)) errors.push(error("backlink.slotRelation", "Back to Map Slot не связан с постом, содержащим backlink", { postId: post.id, nodeId: node.id, targetMapId, targetSlotId, slotTargetPostId: relation.targetPostId || null }));
              }
            }
            usedBacklinkMaps.add(targetMapId);
          }
        }
      });
    }
    return errors;
  }
}

function collectMapSlots(project) {
  const maps = new Map();
  for (const post of project?.posts || []) {
    walk(post.messageAst, node => {
      if (node?.type !== "project_post_map") return;
      const mapId = string(node.props?.mapId);
      if (!mapId) return;
      if (!maps.has(mapId)) maps.set(mapId, new Map());
      const slots = maps.get(mapId);
      for (const slot of Array.isArray(node.props?.slots) ? node.props.slots : []) {
        const slotId = string(slot?.id);
        if (slotId) slots.set(slotId, { targetPostId: string(slot?.targetPostId), hostPostId: post.id });
      }
    });
  }
  return maps;
}

function manualBacklinkTargets(ast) {
  const targets = new Set();
  walk(ast, node => {
    if (node?.type !== "project_map_backlink" || node?.props?.managedByMap === true) return;
    const mapId = string(node.props?.targetMapId);
    if (mapId) targets.add(mapId);
  });
  return targets;
}

function error(code, message, details = {}) { return { code, message, ...details }; }
function string(value) { return value == null ? "" : String(value).trim(); }
function hasNode(ast, predicate) {
  let found = false;
  walk(ast, node => { if (!found && predicate(node)) found = true; });
  return found;
}
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walk(child, fn);
}
