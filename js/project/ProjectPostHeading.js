import { t } from "../i18n/index.js?v=1.8.0";
import { randomUUID } from "../core/Random.js?v=1.5.9";
import { richTextToPlain } from "../core/RichText.js?v=1.5.9";

export function firstHeadingNode(ast) {
  let result = null;
  walk(ast, node => {
    if (!result && node?.type === "heading") result = node;
  });
  return result;
}

export function firstHeadingText(ast) {
  const node = firstHeadingNode(ast);
  return node ? richTextToPlain(node.props?.text || "").trim() : "";
}

export function createProjectHeading(title = t("editor.blockInspector.post")) {
  return {
    id: randomUUID(),
    type: "heading",
    props: { text: cleanTitle(title, t("editor.blockInspector.post")), level: 2 },
    children: []
  };
}

// Project post title is the editor/library projection of its first Heading.
// Renaming a post is therefore a title -> Heading operation. If the post has no
// Heading yet, one is inserted at the beginning of the document.
export function syncHeadingFromPostTitle(post) {
  if (!post) return false;
  post.messageAst ||= { id: "root", type: "document", props: {}, children: [] };
  post.messageAst.children ||= [];
  const title = cleanTitle(post.title, t("editor.blockInspector.post"));
  let changed = String(post.title || "") !== title;
  post.title = title;
  const heading = firstHeadingNode(post.messageAst);
  if (!heading) {
    post.messageAst.children.unshift(createProjectHeading(title));
    return true;
  }
  heading.props ||= {};
  if (richTextToPlain(heading.props.text || "").trim() !== title) {
    // A rename is an explicit replacement of the post's semantic title. Keep all
    // other Heading properties, but make its visible text exactly the new title.
    heading.props.text = title;
    changed = true;
  }
  return changed;
}

// Editor edits flow the opposite way: when the first Heading has a non-empty
// value, it becomes post.title. No Heading is synthesized here; deleting the
// Heading remains an explicit content action until the post is renamed again.
export function syncPostTitleFromHeading(post) {
  if (!post) return false;
  const heading = firstHeadingText(post.messageAst);
  if (!heading || heading === String(post.title || "").trim()) return false;
  post.title = heading;
  return true;
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walk(child, fn);
}

function cleanTitle(value, fallback) {
  const title = String(value ?? "").trim();
  return title || fallback;
}
