import { TelegramApiError } from "./TelegramClient.js?v=1.5.9";

/*
  Project-facing transport.
  Project code may pass an editor BlockTree/AST and let Core render it, or pass an
  already rendered InputRichMessage through the explicit low-level methods.
*/
export class ProjectPreviewTransport {
  constructor({ client, previewChannelBinding, renderer = null, validator = null, events = null }) {
    this.client = client;
    this.previewChannelBinding = previewChannelBinding;
    this.renderer = renderer;
    this.validator = validator;
    this.events = events;
  }

  async getChannel() {
    const slot = await this.previewChannelBinding.getSlot();
    if (slot?.status !== "bound") {
      const reason = slot?.status === "unavailable"
        ? `Канал предпросмотра недоступен: ${slot.reason || "нет доступа"}`
        : "Канал предпросмотра проекта не привязан";
      throw new Error(reason);
    }
    return slot;
  }

  render(tree) {
    if (!this.renderer) throw new Error("Rich Message renderer не подключён к Project Preview Transport");
    if (this.validator) {
      const errors = this.validator.validate(tree);
      if (errors.length) {
        const error = new Error(`Rich Message не прошёл валидацию: ${errors.length} ошибок`);
        error.validationErrors = errors;
        throw error;
      }
    }
    return this.renderer.renderEnvelope ? this.renderer.renderEnvelope(tree) : { richMessage: this.renderer.render(tree), replyMarkup: undefined };
  }

  async send(tree, options = {}) {
    return this.sendEnvelope(this.render(tree), options);
  }

  async edit(messageId, tree) {
    return this.editEnvelope(messageId, this.render(tree));
  }


  async sendEnvelope(envelope, options = {}) {
    return this.sendRichMessage(envelope.richMessage, { ...options, replyMarkup: envelope.replyMarkup });
  }

  async editEnvelope(messageId, envelope) {
    return this.editRichMessage(messageId, envelope.richMessage, { replyMarkup: envelope.replyMarkup });
  }

  async syncEnvelope(messageId, envelope, options = {}) {
    try {
      const message = await this.editEnvelope(messageId, envelope);
      return { action: "edited", message, messageId: Number(messageId) };
    } catch (error) {
      if (error instanceof TelegramApiError && error.isNotModified()) {
        return { action: "unchanged", message: { message_id: Number(messageId) }, messageId: Number(messageId) };
      }
      if (error instanceof TelegramApiError && error.isMessageMissing()) {
        const message = await this.sendEnvelope(envelope, options);
        this.events?.emit("telegram:project-preview-message", {
          action: "recreated", oldMessageId: Number(messageId), message
        });
        return { action: "recreated", message, messageId: Number(message?.message_id || 0) };
      }
      throw error;
    }
  }

  async sendRichMessage(richMessage, { disableNotification = true, replyMarkup } = {}) {
    const channel = await this.getChannel();
    try {
      const message = await this.client.sendRichMessage({
        chatId: channel.chatId,
        richMessage,
        replyMarkup,
        disableNotification
      });
      this.events?.emit("telegram:project-preview-message", { action: "sent", channel, message });
      return message;
    } catch (error) {
      await this.#handleAccessError(channel, error);
      throw error;
    }
  }

  async editRichMessage(messageId, richMessage, { replyMarkup } = {}) {
    const channel = await this.getChannel();
    try {
      const message = await this.client.editRichMessage({
        chatId: channel.chatId,
        messageId: Number(messageId),
        richMessage,
        replyMarkup
      });
      this.events?.emit("telegram:project-preview-message", { action: "edited", channel, messageId: Number(messageId), message });
      return message;
    } catch (error) {
      await this.#handleAccessError(channel, error);
      throw error;
    }
  }

  async deleteMessage(messageId) {
    const channel = await this.getChannel();
    try {
      const result = await this.client.deleteMessage(channel.chatId, Number(messageId));
      this.events?.emit("telegram:project-preview-message", { action: "deleted", channel, messageId: Number(messageId) });
      return result;
    } catch (error) {
      await this.#handleAccessError(channel, error);
      throw error;
    }
  }

  async deleteDeployment(record) {
    if (!record?.chatId || !record?.messageId) return false;
    const channel = await this.getChannel();
    if (Number(channel.chatId) !== Number(record.chatId)) return false;
    try {
      return await this.deleteMessage(record.messageId);
    } catch (error) {
      // A message that was already removed is equivalent to successful cleanup.
      if (error instanceof TelegramApiError && error.isMessageMissing()) return true;
      throw error;
    }
  }

  async #handleAccessError(channel, error) {
    if (!(error instanceof TelegramApiError)) return;
    if (error.errorCode === 403 || /not enough rights|chat not found|bot was kicked|bot is not a member/i.test(error.description || "")) {
      await this.previewChannelBinding.markUnavailable(`telegram_${error.errorCode || "error"}`, error).catch(() => {});
      this.events?.emit("telegram:project-preview-unavailable", { channel, error });
    }
  }
}
