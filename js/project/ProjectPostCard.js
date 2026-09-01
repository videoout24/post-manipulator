import { richTextToPlain } from "../core/RichText.js?v=1.5.9";
import { hasUnappliedProductionChanges } from "./ProjectPublicationState.js?v=1.5.9";
import { projectMapEntryText } from "./ProjectMapText.js?v=1.7.11";

const PREVIEW_LIMIT = 6;

export function createProjectPostCard({
  post,
  variant = "compact",
  selected = false,
  active = false,
  onSelect = null,
  actions = [],
  gallery = null,
  thumbnails = null,
  project = null,
  projectIndex = null,
  onNavigatePost = null,
  onNavigateMap = null,
  showPublicationActions = false,
  onPublish = null,
  onSchedule = null,
  onCancelSchedule = null,
  onApplyChanges = null
} = {}) {
  const published = post?.publication?.state === "published" && Boolean(post?.deployments?.production?.messageId);
  const scheduled = post?.publication?.state === "scheduled" && Boolean(post?.schedule?.scheduledAt);
  const hasProductionChanges = published && hasUnappliedProductionChanges(project, post);
  const hasPublicationFooter = (!published && !scheduled && showPublicationActions)
    || (scheduled && showPublicationActions && Boolean(onCancelSchedule))
    || (published && hasProductionChanges && Boolean(onApplyChanges));
  const noFooter = variant === "compact" && !hasPublicationFooter;
  const card = el("article", `project-post-card project-post-card-${variant}${selected ? " selected" : ""}${active ? " active" : ""}${published ? " project-published" : ""}${noFooter ? " no-footer-actions" : ""}`);
  card.dataset.postId = String(post?.id || "");

  const head = el("div", "project-post-card-head");
  const body = el("div", "project-post-card-body");
  body.append(el("strong", "", post?.title || "Пост"), el("span", "project-post-state", stateLabel(post)));
  head.append(body);

  if (actions.length) {
    const menu = el("div", "project-post-card-actions");
    for (const action of actions) menu.append(action);
    head.append(menu);
  }
  card.append(head);

  if (variant === "overview") {
    card.append(createOverviewPreview(post, {
      gallery,
      thumbnails,
      project,
      projectIndex,
      onNavigatePost,
      onNavigateMap
    }));
  }

  if (!published && !scheduled && showPublicationActions && onPublish) {
    const footer = el("div", "project-post-publication-actions");
    const publish = document.createElement("button");
    publish.type = "button";
    publish.className = "project-publication-publish";
    publish.textContent = "Опубликовать";
    publish.title = "Опубликовать этот Project post в Telegram";
    publish.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onPublish(post);
    };
    footer.append(
      publish,
      onSchedule ? scheduleButton(post, onSchedule) : placeholderButton("Отложить", "Publications: отложенная публикация будет подключена позже")
    );
    card.append(footer);
  } else if (scheduled && showPublicationActions && onCancelSchedule) {
    const footer = el("div", "project-post-publication-actions");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "project-publication-cancel-schedule";
    cancel.textContent = "Отменить отложку";
    cancel.title = "Отменить отложенную публикацию";
    cancel.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onCancelSchedule(post);
    };
    footer.append(cancel);
    card.append(footer);
  } else if (published && hasProductionChanges && onApplyChanges) {
    const footer = el("div", "project-post-publication-actions");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "project-publication-apply";
    apply.textContent = "Применить изменения";
    apply.title = "Обновить опубликованный Project post в Telegram";
    apply.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onApplyChanges(post);
    };
    footer.append(apply);
    card.append(footer);
  } else if (!published && !scheduled && showPublicationActions) {
    const footer = el("div", "project-post-publication-actions");
    footer.append(
      placeholderButton("Опубликовать", "Publications: публикация будет подключена позже"),
      placeholderButton("Отложить", "Publications: отложенная публикация будет подключена позже")
    );
    card.append(footer);
  }

  if (onSelect) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(Boolean(selected)));
    card.onclick = event => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      onSelect(post);
    };
    card.onkeydown = event => {
      if (!["Enter", " "].includes(event.key)) return;
      if (event.target.closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      onSelect(post);
    };
  }
  return card;
}

function createOverviewPreview(post, context) {
  const wrap = el("div", "project-post-overview");
  const entries = collectPreviewEntries(post?.messageAst, PREVIEW_LIMIT);
  if (!entries.length) {
    wrap.append(el("div", "project-post-preview-empty", "Пустой пост"));
    return wrap;
  }

  for (const entry of entries) {
    if (entry.kind === "table") {
      wrap.append(renderMiniTable(entry.node));
      continue;
    }
    if (entry.kind === "media") {
      const media = renderMediaPreview(entry.node);
      wrap.append(media);
      hydrateMediaPreview(media, entry.node, context);
      continue;
    }
    if (entry.kind === "map") {
      wrap.append(renderMapPreview(entry.node, context));
      continue;
    }
    if (entry.kind === "backlink") {
      wrap.append(renderBacklinkPreview(entry.node, context));
      continue;
    }
    wrap.append(renderTextPreview(entry));
  }
  return wrap;
}

function collectPreviewEntries(ast, limit) {
  const out = [];
  let ordinaryCount = 0;
  const visit = node => {
    if (!node) return;
    const p = node.props || {};
    const canAddOrdinary = ordinaryCount < limit;
    switch (node.type) {
      case "heading":
        if (canAddOrdinary && pushText(out, "heading", richTextToPlain(p.text))) ordinaryCount += 1;
        break;
      case "paragraph":
      case "footer":
      case "preformatted":
      case "block_quotation":
      case "expandable_block_quotation":
      case "pull_quotation":
        if (canAddOrdinary && pushText(out, node.type, richTextToPlain(p.text))) ordinaryCount += 1;
        break;
      case "document":
        if (canAddOrdinary && pushText(out, "document", richTextToPlain(p.caption) || "Документ")) ordinaryCount += 1;
        break;
      case "list": {
        if (!canAddOrdinary) break;
        const lines = (p.items || []).map(listItemText).filter(Boolean).slice(0, 4);
        if (lines.length) {
          out.push({ kind: "list", text: lines.join("\n") });
          ordinaryCount += 1;
        }
        break;
      }
      case "table":
        if (canAddOrdinary) {
          out.push({ kind: "table", node });
          ordinaryCount += 1;
        }
        break;
      case "photo":
      case "video":
        if (canAddOrdinary) {
          out.push({ kind: "media", node });
          ordinaryCount += 1;
        }
        break;
      case "project_post_map":
        // Project navigation stays visible even if the ordinary preview limit is reached.
        out.push({ kind: "map", node });
        break;
      case "project_map_backlink":
        out.push({ kind: "backlink", node });
        break;
      default:
        break;
    }
    for (const child of node.children || []) visit(child);
  };
  visit(ast);
  return out;
}

function pushText(out, kind, value) {
  const text = String(value || "").trim();
  if (!text) return false;
  out.push({ kind, text });
  return true;
}

function renderTextPreview(entry) {
  const node = el("div", `project-post-preview-text ${entry.kind === "heading" ? "heading" : ""}`);
  if (entry.kind === "list") {
    for (const line of String(entry.text || "").split("\n")) {
      const row = el("div", "project-post-preview-list-row");
      row.append(el("span", "project-post-preview-bullet", "•"), el("span", "", line));
      node.append(row);
    }
    return node;
  }
  node.textContent = truncate(entry.text, entry.kind === "heading" ? 180 : 320);
  return node;
}

function renderMapPreview(node, { project, onNavigatePost } = {}) {
  const props = node?.props || {};
  const mapId = String(props.mapId || "");
  const wrap = el("section", "project-post-preview-map");
  wrap.dataset.mapId = mapId;
  const head = el("div", "project-post-preview-map-head");
  head.append(el("strong", "", "Post Map"));
  if (mapId) head.append(el("span", "", shortId(mapId)));
  wrap.append(head);

  const slots = Array.isArray(props.slots) ? props.slots : [];
  if (!slots.length) {
    wrap.append(el("div", "project-post-preview-map-empty", props.emptyText || "Карта пока пуста"));
    return wrap;
  }

  const list = el("div", "project-post-preview-map-slots");
  slots.forEach((slot, index) => {
    const row = el("div", "project-post-preview-map-row");
    const targetPostId = String(slot?.targetPostId || "");
    const target = project?.posts?.find(post => post.id === targetPostId) || null;
    row.append(el("span", "project-post-preview-map-status", statusEmoji(target)));
    const label = buildMapEntryText(props, slot, index);
    if (target && onNavigatePost) {
      const link = buttonLike(label || target.title || `Post ${index + 1}`, "project-post-preview-nav-link");
      link.dataset.targetPostId = target.id;
      link.title = `Перейти к карточке: ${target.title || target.id}`;
      link.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        onNavigatePost(target.id);
      };
      row.append(link);
    } else {
      row.append(el("span", targetPostId ? "project-post-preview-map-unresolved" : "project-post-preview-map-slot-empty", label || `${index + 1}.`));
    }
    list.append(row);
  });
  wrap.append(list);
  return wrap;
}

function renderBacklinkPreview(node, { projectIndex, onNavigateMap } = {}) {
  const props = node?.props || {};
  const targetMapId = String(props.targetMapId || "");
  const wrap = el("div", "project-post-preview-backlink");
  wrap.dataset.targetMapId = targetMapId;
  wrap.append(el("span", "project-post-preview-backlink-icon", "↩"));
  const text = String(props.text || "Назад");
  const hostPostId = targetMapId ? projectIndex?.hostPostForMap?.(targetMapId) : null;
  if (hostPostId && onNavigateMap) {
    const link = buttonLike(text, "project-post-preview-nav-link backlink");
    link.title = "Перейти к карте";
    link.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onNavigateMap(targetMapId);
    };
    wrap.append(link);
  } else {
    wrap.append(el("span", "project-post-preview-map-unresolved", text));
  }
  return wrap;
}

function renderMiniTable(node) {
  const wrap = el("div", "project-post-preview-table-wrap");
  const table = document.createElement("table");
  table.className = "project-post-preview-table";
  const rows = Array.isArray(node?.props?.cells) ? node.props.cells.slice(0, 4) : [];
  const maxCols = Math.min(4, Math.max(0, ...rows.map(row => Array.isArray(row) ? row.length : 0)));
  for (const sourceRow of rows) {
    const tr = document.createElement("tr");
    for (const cell of (Array.isArray(sourceRow) ? sourceRow.slice(0, maxCols) : [])) {
      const tag = cell?.is_header ? "th" : "td";
      const td = document.createElement(tag);
      td.textContent = truncate(richTextToPlain(cell?.text), 70) || " ";
      tr.append(td);
    }
    table.append(tr);
  }
  if (!rows.length) wrap.append(el("div", "project-post-preview-empty", "Пустая таблица"));
  else wrap.append(table);
  return wrap;
}

function renderMediaPreview(node) {
  const type = node?.type === "video" ? "Видео" : "Фото";
  const wrap = el("div", `project-post-preview-media ${node?.type || "media"}`);
  const visual = el("div", "project-post-preview-media-thumb");
  visual.dataset.galleryId = String(node?.props?.galleryId || "");
  visual.append(el("span", "project-post-preview-media-icon", node?.type === "video" ? "▶" : "▧"));
  const meta = el("div", "project-post-preview-media-meta");
  const caption = richTextToPlain(node?.props?.caption);
  meta.append(el("strong", "", type), el("span", "", truncate(caption || node?.props?.galleryId || "Gallery media", 120)));
  wrap.append(visual, meta);
  return wrap;
}

async function hydrateMediaPreview(wrap, node, { gallery, thumbnails }) {
  const galleryId = node?.props?.galleryId;
  if (!galleryId || !gallery?.getAsset) return;
  try {
    const asset = await gallery.getAsset(galleryId);
    if (!asset || !wrap.isConnected) return;
    const meta = wrap.querySelector(".project-post-preview-media-meta");
    if (meta) {
      const type = node.type === "video" ? "Видео" : "Фото";
      meta.replaceChildren(
        el("strong", "", asset.caption || asset.fileName || type),
        el("span", "", asset.fileName || asset.mimeType || asset.type || "Gallery media")
      );
    }
    if (!asset.telegram?.thumbnailFileId || !thumbnails?.getUrl) return;
    const url = await thumbnails.getUrl(asset);
    if (!url || !wrap.isConnected) return;
    const thumb = wrap.querySelector(".project-post-preview-media-thumb");
    if (!thumb) return;
    const img = document.createElement("img");
    img.alt = asset.caption || asset.fileName || asset.type || "media";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", async () => {
      if (img.dataset.retry === "1") return;
      img.dataset.retry = "1";
      try {
        const fresh = await thumbnails.getUrl(asset, { forceRefresh: true });
        if (fresh) img.src = fresh;
      } catch {}
    });
    img.src = url;
    thumb.replaceChildren(img);
    if (node.type === "video") thumb.append(el("span", "project-post-preview-video-badge", "▶"));
  } catch (error) {
    console.warn("Project post media preview failed", error);
  }
}

function buildMapEntryText(props, slot, index) {
  return projectMapEntryText(props, slot, index);
}

function statusEmoji(post) {
  if (!post) return "▫️";
  const state = post?.publication?.state;
  if (state === "published") return "👉";
  if (state === "scheduled") return "🕒";
  return "📝";
}

function listItemText(item) {
  const blocks = Array.isArray(item?.blocks) ? item.blocks : [];
  return blocks.map(looseBlockText).filter(Boolean).join(" ").trim();
}

function looseBlockText(block) {
  if (!block || typeof block !== "object") return "";
  if (block.text != null) return richTextToPlain(block.text);
  if (block.props?.text != null) return richTextToPlain(block.props.text);
  return (block.children || []).map(looseBlockText).filter(Boolean).join(" ");
}

function stateLabel(post) {
  const state = post?.publication?.state || "draft";
  if (state === "published") return "👉 Опубликован";
  if (state === "scheduled") return post.schedule ? `🕒 Запланирован · ${formatSchedule(post.schedule)}` : "🕒 Запланирован";
  return "📝 Черновик";
}

function formatSchedule(schedule) {
  const scheduledAt = Number(schedule?.scheduledAt || schedule || 0);
  if (!scheduledAt) return "";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(scheduledAt));
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-5)}` : text;
}

function placeholderButton(text, title = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "publication-placeholder-action";
  node.textContent = text;
  node.title = title;
  node.onclick = event => { event.preventDefault(); event.stopPropagation(); };
  return node;
}

function scheduleButton(post, onSchedule) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "publication-placeholder-action project-publication-schedule";
  node.textContent = "Отложить";
  node.title = "Настроить время отложенной публикации";
  node.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onSchedule(post);
  };
  return node;
}

function buttonLike(text, className = "") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  return node;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}
