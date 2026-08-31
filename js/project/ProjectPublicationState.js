// This snapshot is retained with the production state for auditability and future
// recovery. The UI's Apply action itself is intentionally driven by an explicit
// direct-edit marker: a dependent Map can change its compiled output when another
// post changes, but that must not make the Map look manually edited.
export function productionContentSnapshot(value) {
  return JSON.stringify(canonicalize(value));
}

export function hasUnappliedProductionChanges(project, post) {
  if (!post?.deployments?.production?.messageId || post?.publication?.state !== "published") return false;
  return post.publication?.hasUnappliedChanges === true;
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
