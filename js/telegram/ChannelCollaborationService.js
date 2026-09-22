import { comessageValueFromRichMessage } from "../core/Comessage.js?v=1.12.0";
import { importTelegramRichMessage } from "./TelegramRichMessageImporter.js?v=1.12.0";

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
    const bot = resolveSelectedBot(message, target.collaboration);
    if (!bot) return false;

    const marker = comessageValueFromRichMessage(message.rich_message);
    if (marker) {
      const result = await this.publications.importCollaborativePublication({
        message,
        target,
        bot,
        marker,
        messageAst: importTelegramRichMessage(message.rich_message)
      });
      // A retried update must be able to finish a partially indexed Rich
      // Message. Stable marker+block keys make this replay idempotent and also
      // prevent restored/relinked posts from duplicating their initial media.
      if (result && update.channel_post) {
        for (const media of extractRichMessageMedia(message.rich_message)) {
          await this.events?.emitAsync?.("telegram:collaboration-media", {
            ...media,
            bot: structuredClone(bot),
            collaborationId: marker,
            separate: true,
            caption: media.caption || "",
            date: message.date || null,
            sourceEventKey: `${Number(message.chat.id)}:${String(marker).toLowerCase()}:rich:${media.blockPath}`,
            source: { chatId: Number(message.chat.id), messageId: Number(message.message_id), threadId: null }
          });
        }
      }
      return true;
    }

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
  if (senderId) return bots.find(bot => Number(bot.id) === senderId) || null;
  const signature = normalize(message?.author_signature);
  if (!signature) return null;
  const matches = bots.filter(bot => [bot.username, bot.firstName, `${bot.firstName || ""} ${bot.lastName || ""}`]
    .some(value => normalize(value) === signature));
  return matches.length === 1 ? matches[0] : null;
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
