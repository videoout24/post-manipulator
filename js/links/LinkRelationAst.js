export function materializeRelationUrl(ast, relationId, url) {
  const copy = structuredClone(ast);
  visit(copy, value => {
    if (value?.type === "link_relation" && String(value.relation_id) === String(relationId)) value.url = String(url || "");
    if (value?.props?.relationId === relationId) value.props.url = String(url || "");
  });
  return copy;
}

export function relationIdsInAst(ast) {
  const ids = new Set();
  visit(ast, value => {
    if (value?.type === "link_relation" && value.relation_id) ids.add(String(value.relation_id));
    if (value?.props?.relationId) ids.add(String(value.props.relationId));
  });
  return [...ids];
}

// Returns the enclosing internal-link marker for a selection/caret range.  The
// editor works with plain-text offsets, while RichText can be nested, so this
// traversal keeps the original marker boundaries for a clean unlink.
export function findLinkRelationAtRange(value, start, end = start) {
  const from = Math.max(0, Number(start) || 0);
  const to = Math.max(from, Number(end) || 0);
  let found = null;
  visitRichText(value, 0, (node, nodeStart, nodeEnd) => {
    if (found || node?.type !== "link_relation" || !node.relation_id) return;
    const overlaps = from === to
      ? from >= nodeStart && from <= nodeEnd
      : from < nodeEnd && to > nodeStart;
    if (overlaps) {
      found = {
        relationId: String(node.relation_id),
        value: node,
        start: nodeStart,
        end: nodeEnd
      };
    }
  });
  return found;
}

// Used when navigation arrives at a source document from a green target-card
// button.  Unlike a range lookup, the relation id lets the Editor restore the
// exact fragment that initiated the navigation.
export function findLinkRelationById(value, relationId) {
  const wantedId = String(relationId || "");
  if (!wantedId) return null;
  let found = null;
  visitRichText(value, 0, (node, start, end) => {
    if (found || node?.type !== "link_relation" || String(node.relation_id || "") !== wantedId) return;
    found = {
      relationId: wantedId,
      value: node,
      start,
      end
    };
  });
  return found;
}

export function unwrapLinkRelation(value, relationId) {
  if (value == null || typeof value === "string" || typeof value === "number") return structuredClone(value);
  if (Array.isArray(value)) return compact(value.map(item => unwrapLinkRelation(item, relationId)));
  if (typeof value !== "object") return value;
  if (value.type === "link_relation" && String(value.relation_id) === String(relationId)) {
    return unwrapLinkRelation(value.text ?? "", relationId);
  }
  const copy = structuredClone(value);
  if ("text" in copy) copy.text = unwrapLinkRelation(copy.text, relationId);
  return copy;
}

export function removeLinkRelationFromAst(ast, relationId) {
  return removeRelationFromAstValue(ast, relationId);
}

export function renderableRichText(value) {
  if (Array.isArray(value)) return value.map(renderableRichText);
  if (!value || typeof value !== "object") return value;
  if (value.type === "link_relation") {
    const text = renderableRichText(value.text || "");
    return value.url ? { type: "url", text, url: String(value.url) } : text;
  }
  const copy = structuredClone(value);
  if ("text" in copy) copy.text = renderableRichText(copy.text);
  return copy;
}

function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  callback(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(item => visit(item, callback));
    else if (child && typeof child === "object") visit(child, callback);
  }
}

function visitRichText(value, offset, callback) {
  if (value == null) return offset;
  if (typeof value === "string" || typeof value === "number") return offset + String(value).length;
  if (Array.isArray(value)) {
    let cursor = offset;
    for (const child of value) cursor = visitRichText(child, cursor, callback);
    return cursor;
  }
  if (typeof value !== "object") return offset;
  const text = "text" in value ? value.text : "";
  const length = richTextTextLength(text);
  callback(value, offset, offset + length);
  if ("text" in value) return visitRichText(text, offset, callback);
  return offset + length;
}

function richTextTextLength(value) {
  if (value == null) return 0;
  if (typeof value === "string" || typeof value === "number") return String(value).length;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + richTextTextLength(child), 0);
  if (typeof value === "object" && "text" in value) return richTextTextLength(value.text);
  return 0;
}

function compact(value) {
  const out = [];
  for (const item of value.flatMap(item => Array.isArray(item) ? item : [item])) {
    if (item == null || item === "") continue;
    if (typeof item === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += item;
    else out.push(item);
  }
  if (!out.length) return "";
  return out.length === 1 ? out[0] : out;
}

function removeRelationFromAstValue(value, relationId) {
  if (value == null || typeof value === "string" || typeof value === "number") return structuredClone(value);
  if (Array.isArray(value)) return value.map(item => removeRelationFromAstValue(item, relationId));
  if (typeof value !== "object") return value;
  if (value.type === "link_relation" && String(value.relation_id) === String(relationId)) {
    return removeRelationFromAstValue(value.text ?? "", relationId);
  }
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = key === "text"
      ? unwrapLinkRelation(item, relationId)
      : removeRelationFromAstValue(item, relationId);
  }
  if (String(copy?.props?.relationId || "") === String(relationId)) {
    copy.props.relationId = "";
    copy.props.relationTargetTitle = "";
    copy.props.relationTargetKind = "";
    copy.props.url = "";
  }
  return copy;
}
