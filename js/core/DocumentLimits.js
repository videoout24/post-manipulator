export const TELEGRAM_LIMITS = Object.freeze({
  maxBlocks: 500,
  maxDepth: 16
});

export function countSubtree(node) {
  if (!node || node.type === "url_button") return 0;
  let count = 1;
  for (const child of node.children || []) count += countSubtree(child);
  return count;
}

export function subtreeHeight(node) {
  if (!node || node.type === "url_button") return 0;
  const children = node.children || [];
  if (!children.length) return 1;
  return 1 + Math.max(...children.map(subtreeHeight));
}

export function countBlocks(tree) {
  return (tree.root?.children || []).reduce((sum, node) => sum + countSubtree(node), 0);
}

export function maxDepth(tree) {
  const children = tree.root?.children || [];
  if (!children.length) return 0;
  return Math.max(...children.map(subtreeHeight));
}

export function depthOf(tree, nodeId) {
  if (nodeId === "root") return 0;
  const node = tree.find(nodeId);
  if (!node) return -1;

  let depth = 1;
  let parent = tree.parentOf(nodeId);
  while (parent && parent.id !== "root") {
    depth++;
    parent = tree.parentOf(parent.id);
  }
  return depth;
}

export function definitionFootprint(definition) {
  if (!definition) return { count: 1, height: 1 };
  if (definition.wire?.kind === "reply_markup") return { count: 0, height: 0 };
  const template = definition.kind === "meta" ? (definition.template || []) : [];
  if (!template.length) return { count: 1, height: 1 };

  const templateCount = template.reduce((sum, node) => sum + countTemplateSubtree(node), 0);
  const templateHeight = Math.max(...template.map(templateSubtreeHeight));
  return {
    count: 1 + templateCount,
    height: 1 + templateHeight
  };
}

export function treeStats(tree) {
  return {
    blockCount: countBlocks(tree),
    maxDepth: maxDepth(tree),
    maxBlocks: TELEGRAM_LIMITS.maxBlocks,
    maxDepthLimit: TELEGRAM_LIMITS.maxDepth
  };
}

function countTemplateSubtree(node) {
  let count = 1;
  for (const child of node.children || []) count += countTemplateSubtree(child);
  return count;
}

function templateSubtreeHeight(node) {
  const children = node.children || [];
  if (!children.length) return 1;
  return 1 + Math.max(...children.map(templateSubtreeHeight));
}
