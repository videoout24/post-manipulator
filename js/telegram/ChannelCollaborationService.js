import { comessageValueFromRichMessage } from "../core/Comessage.js?v=1.12.1";
import { importTelegramRichMessage } from "./TelegramRichMessageImporter.js?v=1.12.1";

export class ChannelCollaborationService {
  constructor({ events = null, publicationTargets, publications } = {}) {
    this.events = events;
    this.publicationTargets = publicationTargets;
    this.publications = publications;
  }

  async handleUpdate(update) {
    try {
      return await this.#handleUpdate(update);
    } catch (error) {
      error.retryTelegramUpdate = true;
      throw error;
    }
  }

  async #handleUpdate(update) {
    const message = update?.channel_post || update?.edited_channel_post;
    if (message?.chat?.type !== "channel") return false;
    const target = (await this.publicationTargets?.list?.() || []).find(item => Number(item.chatId) === Number(message.chat.id));
    if (!target || target.type !== "channel" || target.visibility !== "private" || !target.collaboration?.enabled) return false;
    const marker = comessageValueFromRichMessage(message.rich_message);
    if (marker) {
      const existing = await this.publications.getCollaborativePublication?.(message.chat.id, marker);
      const selectedBot = resolveSelectedBot(message, target.collaboration);
      if (!selectedBot && !existing) return false;
      const bot = selectedBot || collaborationBotFromRecord(existing, target.collaboration);
      const messageAst = importTelegramRichMessage(message.rich_message);
      preserveMediaBindings(messageAst, existing?.messageAst);

      for (const media of extractRichMessageMedia(message.rich_message)) {
        if (hasGalleryBinding(messageAst, media)) continue;
        const results = await this.events?.emitAsync?.("telegram:collaboration-media", {
          ...media,
          bot: structuredClone(bot),
          collaborationId: marker,
          separate: true,
          caption: media.caption || "",
          date: message.date || null,
          sourceEventKey: `${Number(message.chat.id)}:${String(marker).toLowerCase()}:rich:${media.blockPath}:${media.fileUniqueId || media.fileId}`,
          source: { chatId: Number(message.chat.id), messageId: Number(message.message_id), threadId: null }
        }) || [];
        const asset = results.find(value => value?.id && value?.telegram?.fileId);
        if (asset) bindGalleryAsset(messageAst, media, asset);
      }

      await this.publications.importCollaborativePublication({
        message,
        target,
        bot,
        marker,
        messageAst,
        updateId: update?.update_id
      });
      return true;
    }

    const bot = resolveSelectedBot(message, target.collaboration);
    if (!bot) return false;
    const media = extractMessageMedia(message);
    if (!media) return false;
    await this.events?.emitAsync?.("telegram:collaboration-media", {
      ...media,
      bot: structuredClone(bot),
      collaborationId: null,
      separate: false,
      caption: message.caption || "",
      date: message.date || null,
      sourceEventKey: `${Number(message.chat.id)}:${Number(message.message_id)}`,
      source: { chatId: Number(message.chat.id), messageId: Number(message.message_id), threadId: null }
    });
    return true;
  }
}

function resolveSelectedBot(message, collaboration) {
  const bots = (collaboration?.bots || []).filter(bot => collaboration.selectedBotIds?.includes(Number(bot.id)));
  const senderId = Number(message?.from?.id || 0);
  if (senderId) {
    const sender = bots.find(bot => Number(bot.id) === senderId);
    if (sender) return sender;
  }
  const signature = normalize(message?.author_signature);
  if (!signature) return null;
  const matches = bots.filter(bot => [bot.username, bot.firstName, `${bot.firstName || ""} ${bot.lastName || ""}`]
    .some(value => normalize(value) === signature));
  return matches.length === 1 ? matches[0] : null;
}

function collaborationBotFromRecord(record, collaboration) {
  const bots = (collaboration?.bots || []).filter(bot => collaboration.selectedBotIds?.includes(Number(bot.id)));
  const originId = Number(record?.collaboration?.originBotId || 0);
  return bots.find(bot => Number(bot.id) === originId)
    || bots[0]
    || { id: originId, username: record?.collaboration?.originBotUsername || "", firstName: "CoMessage" };
}

function preserveMediaBindings(nextAst, previousAst) {
  if (!previousAst) return;
  const bindings = new Map();
  for (const node of importedMediaNodes(previousAst)) {
    const key = importedMediaKey(node);
    if (!key || !node.props?.galleryId) continue;
    if (!bindings.has(key)) bindings.set(key, []);
    bindings.get(key).push(String(node.props.galleryId));
  }
  for (const node of importedMediaNodes(nextAst)) {
    const values = bindings.get(importedMediaKey(node));
    if (!node.props?.galleryId && values?.length) node.props.galleryId = values.shift();
  }
}

function hasGalleryBinding(ast, media) {
  const matches = importedMediaNodes(ast).filter(node => importedNodeMatchesMedia(node, media));
  return matches.length > 0 && matches.every(node => node.props?.galleryId);
}

function bindGalleryAsset(ast, media, asset) {
  const node = importedMediaNodes(ast).find(candidate => importedNodeMatchesMedia(candidate, media) && !candidate.props?.galleryId);
  if (!node) return false;
  node.props.galleryId = String(asset.id);
  node.props.fileId = String(asset.telegram.fileId || media.fileId || "");
  if (node.type === "animation") node.props.url = "";
  return true;
}

function importedMediaNodes(ast) {
  const nodes = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (["animation", "audio", "document", "photo", "video", "voice_note"].includes(node.type)) nodes.push(node);
    for (const child of node.children || []) visit(child);
    for (const item of node.props?.items || []) for (const block of item?.blocks || []) visit(block);
  };
  visit(ast);
  return nodes;
}

function importedMediaKey(node) {
  const fileId = String(node?.props?.fileId || (node?.type === "animation" ? node?.props?.url : "") || "");
  return fileId ? `${node.type}:${fileId}` : "";
}

function importedNodeMatchesMedia(node, media) {
  const nodeType = node?.type === "voice_note" ? "voice" : node?.type;
  return nodeType === media?.type && importedMediaKey(node).endsWith(`:${String(media?.fileId || "")}`);
}

function extractRichMessageMedia(richMessage) {
  const media = [];
  const visit = (blocks, prefix = "") => {
    (blocks || []).forEach((block, index) => {
      const path = prefix ? `${prefix}.${index}` : String(index);
      const item = mediaFromRichBlock(block);
      if (item) media.push({ ...item, blockPath: path });
      if (Array.isArray(block?.blocks)) visit(block.blocks, path);
      for (let itemIndex = 0; itemIndex < (block?.items || []).length; itemIndex += 1) {
        visit(block.items[itemIndex]?.blocks, `${path}.item${itemIndex}`);
      }
    });
  };
  visit(richMessage?.blocks || []);
  return media;
}

function mediaFromRichBlock(block) {
  const caption = richTextPlain(block?.caption?.text);
  if (block?.type === "photo" && Array.isArray(block.photo) && block.photo.length) {
    const sizes = [...block.photo].sort((a, b) => Number(a.width || 0) * Number(a.height || 0) - Number(b.width || 0) * Number(b.height || 0));
    const object = sizes.at(-1);
    return {
      type: "photo", fileId: object.file_id, fileUniqueId: object.file_unique_id,
      thumbnailFileId: sizes[0]?.file_id || object.file_id, width: object.width, height: object.height,
      fileSize: object.file_size || null, caption
    };
  }
  const fields = {
    animation: ["animation", "animation"],
    audio: ["audio", "audio"],
    document: ["document", "document"],
    video: ["video", "video"],
    voice_note: ["voice_note", "voice"]
  };
  const [field, type] = fields[block?.type] || [];
  return field && block[field] ? mediaFromObject(type, block[field], caption) : null;
}

function extractMessageMedia(message) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const sizes = [...message.photo].sort((a, b) => Number(a.width || 0) * Number(a.height || 0) - Number(b.width || 0) * Number(b.height || 0));
    const object = sizes.at(-1);
    return {
      type: "photo", fileId: object.file_id, fileUniqueId: object.file_unique_id,
      thumbnailFileId: sizes[0]?.file_id || object.file_id, width: object.width, height: object.height,
      fileSize: object.file_size || null
    };
  }
  for (const type of ["video", "audio", "voice", "document", "animation"]) {
    if (message?.[type]) return mediaFromObject(type, message[type]);
  }
  return null;
}

function mediaFromObject(type, object, caption = "") {
  return {
    type,
    fileId: object.file_id,
    fileUniqueId: object.file_unique_id,
    thumbnailFileId: object.thumbnail?.file_id || null,
    fileName: object.file_name || "",
    mimeType: object.mime_type || "",
    fileSize: object.file_size || null,
    duration: object.duration || null,
    width: object.width || null,
    height: object.height || null,
    caption
  };
}

function richTextPlain(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(richTextPlain).join("");
  if (typeof value === "object" && "text" in value) return richTextPlain(value.text);
  return "";
}

function normalize(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}
