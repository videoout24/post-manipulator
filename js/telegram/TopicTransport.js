export class TopicTransport {
  constructor({ client, ownerBinding, events = null }) {
    this.client = client;
    this.ownerBinding = ownerBinding;
    this.events = events;
  }

  async create(name) {
    const owner = await this.#owner();
    const normalized = normalizeName(name);
    const result = await this.client.createForumTopic(owner.chatId, normalized);
    const topic = {
      chatId: Number(owner.chatId),
      threadId: Number(result.message_thread_id),
      name: result.name || normalized,
      iconColor: result.icon_color || null,
      iconCustomEmojiId: result.icon_custom_emoji_id || null
    };
    this.events?.emit("telegram:topic-created", topic);
    return topic;
  }

  async rename(threadId, name) {
    const owner = await this.#owner();
    const id = Number(threadId);
    if (!Number.isFinite(id) || !id) throw new Error("Некорректный message_thread_id");
    const normalized = normalizeName(name);
    try {
      await this.client.editForumTopic(owner.chatId, id, { name: normalized });
    } catch (error) {
      if (isMissingTopic(error)) return null;
      throw error;
    }
    const topic = { chatId: Number(owner.chatId), threadId: id, name: normalized };
    this.events?.emit("telegram:topic-renamed", topic);
    return topic;
  }

  async delete(threadId) {
    const owner = await this.#owner();
    const id = Number(threadId);
    if (!Number.isFinite(id) || !id) throw new Error("Некорректный message_thread_id");
    let alreadyMissing = false;
    try {
      await this.client.deleteForumTopic(owner.chatId, id);
    } catch (error) {
      if (!isMissingTopic(error)) throw error;
      alreadyMissing = true;
    }
    const topic = { chatId: Number(owner.chatId), threadId: id, deleted: true, alreadyMissing };
    this.events?.emit("telegram:topic-deleted", topic);
    return topic;
  }

  async #owner() {
    const owner = await this.ownerBinding.getOwner();
    if (!owner) throw new Error("Сначала привяжите владельца");
    return owner;
  }
}

function isMissingTopic(error) {
  if (error instanceof TelegramApiError) return error.isTopicProblem();
  return /message thread not found|thread.*not found|topic.*not found|message_thread_id|topic_id_invalid/i.test(String(error?.message || error || ""));
}

function normalizeName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Название topic не может быть пустым");
  if ([...name].length > 128) throw new Error("Название topic не должно превышать 128 символов");
  return name;
}
import { TelegramApiError } from "./TelegramClient.js?v=1.5.9";
