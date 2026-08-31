import { firstHeadingText } from "./ProjectPostHeading.js?v=1.5.9";

// Only these AST inputs can change the canonical Project relation graph. Derived
// slot labels and managed backlinks are deliberately excluded: they are outputs of
// reconciliation and must not cause another reconciliation cycle by themselves.
export function projectGraphInputFingerprint(ast) {
  const maps = [];
  const manualBacklinks = [];

  walk(ast, node => {
    if (node?.type === "project_post_map") {
      maps.push({
        mapId: clean(node.props?.mapId),
        slots: (Array.isArray(node.props?.slots) ? node.props.slots : []).map(slot => ({
          id: clean(slot?.id),
          targetPostId: clean(slot?.targetPostId)
        }))
      });
      return;
    }
    if (node?.type === "project_map_backlink" && node.props?.managedByMap !== true) {
      manualBacklinks.push({ mapId: clean(node.props?.targetMapId) });
    }
  });

  return JSON.stringify({
    heading: firstHeadingText(ast),
    maps,
    manualBacklinks
  });
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

