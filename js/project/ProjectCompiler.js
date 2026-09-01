import { BlockTree } from "../core/BlockTree.js?v=1.5.9";
import { ProjectIndex } from "./ProjectIndex.js?v=1.5.9";
import { ProjectDeploymentResolver } from "./ProjectDeploymentResolver.js?v=1.5.9";
import { projectMapEntryText } from "./ProjectMapText.js?v=1.7.11";

export class ProjectCompiler {
  compilePost(project, postId, { deployment = "preview", index = null, resolver = null, sourceAst = null } = {}) {
    const post = project?.posts?.find(item => item.id === postId);
    if (!post) throw new Error(`Project post not found: ${postId}`);
    const projectIndex = index || new ProjectIndex(project);
    const deploymentResolver = resolver || new ProjectDeploymentResolver({ project, index: projectIndex, deployment });
    const ast = sourceAst || post.messageAst;
    const root = {
      id: "root",
      type: "document",
      props: {},
      children: this.#compileChildren(ast?.children || [], { project, post, index: projectIndex, resolver: deploymentResolver, deployment })
    };
    return new BlockTree(root);
  }

  #compileChildren(children, context) {
    return (children || []).flatMap(node => this.#compileNode(node, context));
  }

  #compileNode(node, context) {
    if (!node || typeof node !== "object") return [];
    if (node.type === "project_post_map") return this.#compileMap(node, context);
    if (node.type === "project_map_backlink") return [this.#compileBacklink(node, context)];
    const copy = structuredClone(node);
    copy.children = this.#compileChildren(node.children || [], context);
    return [copy];
  }

  #compileMap(node, context) {
    const props = node.props || {};
    const slots = Array.isArray(props.slots) ? props.slots : [];
    if (!slots.length) {
      return [paragraph(`${statusEmoji("empty")} ${String(props.emptyText || "Карта пока пуста")}`, `${node.id}:empty`)];
    }

    return slots.map((slot, index) => {
      const targetPost = context.project.posts.find(post => post.id === slot?.targetPostId) || null;
      const state = targetPost ? logicalState(targetPost) : "empty";
      const entryText = projectMapEntryText(props, slot, index);
      const leading = state === "scheduled"
        ? scheduledStatusPrefix(targetPost?.schedule)
        : `${statusEmoji(state)} `;
      const resolved = targetPost ? context.resolver.resolvePost(targetPost.id) : null;
      const entry = resolved?.url ? { type: "url", text: entryText, url: resolved.url } : entryText;
      const text = Array.isArray(leading)
        ? [...leading, entry]
        : resolved?.url ? [leading, entry] : `${leading}${entryText}`;
      return paragraph(text, `${node.id}:slot:${slot?.id || index}`);
    });
  }

  #compileBacklink(node, context) {
    const props = node.props || {};
    const text = String(props.text || "Назад");
    const resolved = props.targetMapId ? context.resolver.resolveMap(String(props.targetMapId)) : null;
    return paragraph(resolved?.url ? { type: "url", text, url: resolved.url } : text, `${node.id}:compiled`);
  }
}

function paragraph(text, id) {
  return { id, type: "paragraph", props: { text }, children: [] };
}

function logicalState(post) {
  const state = post?.publication?.state;
  if (state === "published") return "published";
  if (state === "scheduled") return "scheduled";
  return "draft";
}

function statusEmoji(state) {
  if (state === "published") return "👉";
  if (state === "scheduled") return "🕒";
  if (state === "draft") return "📝";
  return "▫️";
}

function scheduledStatusPrefix(schedule) {
  const scheduledAt = Number(schedule?.scheduledAt || 0);
  if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) return [statusEmoji("scheduled"), " "];
  return [{
    type: "date_time",
    text: statusEmoji("scheduled"),
    unix_time: Math.floor(scheduledAt / 1000),
    // An empty Telegram format preserves the icon text while keeping the
    // timestamp available from the entity's context menu.
    date_time_format: ""
  }, " "];
}
