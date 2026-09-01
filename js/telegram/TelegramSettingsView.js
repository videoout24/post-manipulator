import { confirmDarkDialog } from "../core/DarkDialog.js?v=1.6.5";

const NATIVE_INTEGRATION_KEY = "telegramNativeIntegration";
const NETWORK_PANEL_START_EXPANDED_KEY = "networkPanelStartExpanded";
export class TelegramSettingsView {
  constructor({ root, db, events, client, runtime, ownerBinding, previewChannelBinding, previewController, botIdentity, navigation = null, verifiedBot = null }) {
    this.root = root;
    this.db = db;
    this.events = events;
    this.client = client;
    this.runtime = runtime;
    this.ownerBinding = ownerBinding;
    this.previewChannelBinding = previewChannelBinding;
    this.previewController = previewController;
    this.botIdentity = botIdentity;
    this.navigation = navigation;
    this.verifiedBot = verifiedBot;
    this.documentRoot = root?.ownerDocument || globalThis.document;
    this.storageManager = globalThis.navigator?.storage || null;
    this.storagePersistence = { supported: Boolean(this.storageManager?.persist), granted: false, usage: null, quota: null };
    this.bot = null;
    this.previewStatus = null;
    this.networkPanel = null;
    this.networkPanelStartExpanded = false;
    this.#bind();
    this.#listen();
  }

  async initialize() {
    await this.botIdentity?.initialize();
    this.bot = this.verifiedBot || await this.botIdentity?.getIdentity();
    this.networkPanelStartExpanded = Boolean(await this.db.get("settings", NETWORK_PANEL_START_EXPANDED_KEY, false));
    this.networkPanel?.setExpanded(this.networkPanelStartExpanded);
    await this.#refreshStoragePersistence();
    await this.render();
  }

  setNetworkPanel(panel) {
    this.networkPanel = panel || null;
    this.networkPanel?.setExpanded(this.networkPanelStartExpanded);
  }

  #listen() {
    const refresh = () => this.render().catch(() => {});
    for (const name of [
      "telegram:runtime-status",
      "telegram:owner-bound",
      "telegram:owner-unbound",
      "telegram:channel-binding",
      "telegram:preview-channel",
      "telegram:media-settings",
      "telegram:live-preview-setting",
      "telegram:native-integration-setting"
    ]) this.events?.on(name, refresh);

    this.events?.on("telegram:preview-status", status => {
      this.previewStatus = status;
      refresh();
    });
    this.events?.on("telegram:channel-binding-rejected", payload => {
      const reason = payload?.reason === "public_channel"
        ? "Этот слот принимает только приватный канал"
        : `Канал не подходит: ${payload?.reason || "недостаточно прав"}`;
      this.#notice(reason, true);
      refresh();
    });
  }

  #bind() {
    this.root.querySelector("#requestPersistentStorage")?.addEventListener("click", () => this.#requestPersistentStorage());
    this.root.querySelector("#tgStart")?.addEventListener("click", () => this.#run(() => this.runtime.start()));
    this.root.querySelector("#tgStop")?.addEventListener("click", () => this.#run(() => this.runtime.stop()));
    this.root.querySelector("#tgClearWebhook")?.addEventListener("click", () => this.#run(async () => {
      await this.runtime.clearWebhook();
      this.#notice("Webhook отключён. Long polling можно запускать.");
    }));
    this.root.querySelector("#tgOpenBotFather")?.addEventListener("click", () => {
      if (!this.navigation?.openBot?.("BotFather")) this.#notice("Не удалось открыть BotFather", true);
    });

    this.root.querySelector("#tgUnbindOwner")?.addEventListener("click", () => this.#unbindOwner());

    this.root.querySelector("#tgPreviewSync")?.addEventListener("click", () => this.#run(() => this.previewController.sync({ force: true })));
    this.root.querySelector("#tgPreviewOpen")?.addEventListener("click", () => this.#openPreview());

    this.root.querySelector("#tgStartChannelBind")?.addEventListener("click", () => this.#startChannelBinding());
    this.root.querySelector("#tgCancelChannelBind")?.addEventListener("click", () => this.#run(() => this.previewChannelBinding.cancelBinding()));
    this.root.querySelector("#tgUnbindChannel")?.addEventListener("click", () => this.#run(() => this.previewChannelBinding.unbind()));
    this.root.querySelector("#tgCopyChannelCode")?.addEventListener("click", () => this.#copy(this.root.querySelector("#tgChannelBindCode")?.value));

    this.root.querySelector("#tgLivePreview")?.addEventListener("change", event => {
      this.#run(() => this.previewController.setEnabled(event.target.checked));
    });
    this.root.querySelector("#tgNativeIntegration")?.addEventListener("change", event => {
      this.#run(async () => {
        const enabled = Boolean(event.target.checked);
        await this.db.put("settings", NATIVE_INTEGRATION_KEY, enabled);
        this.events?.emit("telegram:native-integration-setting", { enabled });
      });
    });
    this.root.querySelector("#networkPanelStartExpanded")?.addEventListener("change", event => {
      this.#run(async () => {
        this.networkPanelStartExpanded = Boolean(event.target.checked);
        await this.db.put("settings", NETWORK_PANEL_START_EXPANDED_KEY, this.networkPanelStartExpanded);
        this.networkPanel?.setExpanded(this.networkPanelStartExpanded);
      });
    });
    for (const input of this.root.querySelectorAll("[data-owner-media]")) {
      input.addEventListener("change", () => this.#saveMediaSettings());
    }
  }

  async #unbindOwner() {
    if (!await confirmDarkDialog({
      title: "Отвязать владельца?",
      message: "Канал предпросмотра также будет отвязан.",
      confirmLabel: "Отвязать",
      danger: true
    })) return;
    await this.#run(async () => {
      await this.ownerBinding.unbind();
      await this.previewChannelBinding.unbind();
      await this.previewController.setEnabled(false);
    });
  }

  async #startChannelBinding() {
    await this.#run(async () => {
      if (!this.runtime.getStatus().running) await this.runtime.start();
      await this.previewChannelBinding.startBinding();
      this.#notice("Ожидаю добавление бота администратором приватного канала и код подтверждения.");
    });
  }

  async #saveMediaSettings() {
    const next = {};
    for (const input of this.root.querySelectorAll("[data-owner-media]")) next[input.dataset.ownerMedia] = input.checked;
    await this.runtime.setMediaSettings(next);
  }

  async render() {
    const [owner, slot, channelSession, media, liveEnabled, liveMessage, nativeEnabled] = await Promise.all([
      this.ownerBinding.getOwner(),
      this.previewChannelBinding.getSlot(),
      this.previewChannelBinding.getSession(),
      this.runtime.getMediaSettings(),
      this.previewController.isEnabled(),
      this.previewController.getMessage(),
      this.db.get("settings", NATIVE_INTEGRATION_KEY, true)
    ]);
    this.bot = this.bot || await this.botIdentity?.getIdentity();
    const runtimeStatus = this.runtime.getStatus();
    const hasToken = this.client.hasToken();

    const persistence = this.storagePersistence;
    setText(this.root, "#storagePersistenceState", !persistence.supported
      ? "Браузер не поддерживает запрос постоянного хранилища"
      : persistence.granted
        ? "Постоянное хранилище включено"
        : "IndexedDB пока может быть автоматически удалена браузером");
    setText(this.root, "#storagePersistenceUsage", formatStorageUsage(persistence.usage, persistence.quota));
    setDisabled(this.root, "#requestPersistentStorage", !persistence.supported || persistence.granted);
    setHidden(this.root, "#requestPersistentStorage", persistence.granted);

    setText(this.root, "#tgTokenStored", hasToken
      ? "Token зашифрован в Telegram CloudStorage и активен только в памяти этого запуска"
      : "Защищённый token недоступен; перезапустите Mini App");
    const networkPanelStartExpanded = this.root.querySelector("#networkPanelStartExpanded");
    if (networkPanelStartExpanded) networkPanelStartExpanded.checked = this.networkPanelStartExpanded;
    setText(this.root, "#tgBotIdentity", this.bot
      ? `@${this.bot.username || "—"} · id ${this.bot.id}`
      : "Бот не проверен");

    const statusEl = this.root.querySelector("#tgRuntimeStatus");
    if (statusEl) {
      statusEl.textContent = runtimeStatus.message;
      statusEl.dataset.state = runtimeStatus.state;
    }
    setDisabled(this.root, "#tgStart", runtimeStatus.running || !hasToken);
    setDisabled(this.root, "#tgStop", !runtimeStatus.running);

    setText(this.root, "#tgOwnerState", owner
      ? `Привязан: ${owner.firstName || owner.username || owner.userId} · user ${owner.userId} · chat ${owner.chatId}`
      : "Владелец не привязан");
    setHidden(this.root, "#tgUnbindOwner", !owner);

    const channelReady = slot?.status === "bound";
    setText(this.root, "#tgPreviewChannelState", channelReady
      ? `Live-preview публикуется в «${slot.title || slot.chatId}»`
      : "Live-preview недоступен без приватного канала");
    const live = this.root.querySelector("#tgLivePreview");
    if (live) {
      live.checked = liveEnabled;
      live.disabled = !channelReady;
    }
    const nativeIntegration = this.root.querySelector("#tgNativeIntegration");
    if (nativeIntegration) nativeIntegration.checked = Boolean(nativeEnabled);
    setDisabled(this.root, "#tgPreviewSync", !channelReady || !liveEnabled);
    setDisabled(this.root, "#tgPreviewOpen", !channelReady || !liveMessage?.messageId || Number(liveMessage.chatId) !== Number(slot.chatId));
    setText(this.root, "#tgPreviewStatus", this.previewStatus?.message || "Live-preview ещё не синхронизировался");

    for (const input of this.root.querySelectorAll("[data-owner-media]")) input.checked = Boolean(media[input.dataset.ownerMedia]);

    const slotText = slot?.status === "bound"
      ? `Привязан: ${slot.title || slot.chatId} · ${slot.chatId}`
      : slot?.status === "unavailable"
        ? `Недоступен: ${slot.title || slot.chatId} · ${slot.reason || "нет прав"}`
        : owner ? "Слот свободен" : "Станет доступен после привязки владельца";
    setText(this.root, "#tgChannelState", slotText);
    setHidden(this.root, "#tgStartChannelBind", !owner || slot?.status === "bound" || slot?.status === "unavailable" || Boolean(channelSession));
    setHidden(this.root, "#tgUnbindChannel", !owner || !(slot?.status === "bound" || slot?.status === "unavailable"));
    setHidden(this.root, "#tgChannelBindingBox", !owner || !channelSession);

    const code = this.root.querySelector("#tgChannelBindCode");
    if (code) code.value = channelSession?.code || "";
    setText(this.root, "#tgChannelCandidate", channelSession?.candidate
      ? `Кандидат: ${channelSession.candidate.title} · ${channelSession.candidate.chatId}. Теперь опубликуйте код подтверждения.`
      : channelSession ? "Кандидат ещё не обнаружен. Добавьте бота администратором приватного канала, затем опубликуйте код." : "");

    const addLink = this.root.querySelector("#tgAddToChannelLink");
    if (addLink) {
      const username = this.bot?.username || "";
      addLink.href = username ? `https://t.me/${username}?startchannel&admin=post_messages+edit_messages+delete_messages` : "#";
      addLink.classList.toggle("disabled-link", !username);
    }
  }

  async #run(action) {
    try {
      const result = await action();
      await this.render();
      return result;
    } catch (error) {
      console.error(error);
      this.#notice(error?.message || String(error), true);
      await this.render().catch(() => {});
      return false;
    }
  }

  async #refreshStoragePersistence() {
    if (!this.storageManager?.persist || !this.storageManager?.persisted) {
      this.storagePersistence = { supported: false, granted: false, usage: null, quota: null };
      return this.storagePersistence;
    }
    const [granted, estimate] = await Promise.all([
      this.storageManager.persisted(),
      this.storageManager.estimate?.().catch?.(() => null) || null
    ]);
    this.storagePersistence = {
      supported: true,
      granted: Boolean(granted),
      usage: finiteOrNull(estimate?.usage),
      quota: finiteOrNull(estimate?.quota)
    };
    return this.storagePersistence;
  }

  async #requestPersistentStorage() {
    await this.#run(async () => {
      if (!this.storageManager?.persist) throw new Error("Браузер не поддерживает постоянное хранилище");
      const granted = await this.storageManager.persist();
      await this.#refreshStoragePersistence();
      if (!granted) throw new Error("Браузер не предоставил постоянное хранилище");
      this.#notice("IndexedDB защищена от автоматического удаления браузером");
    });
  }

  async #copy(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.#notice("Скопировано");
    } catch {
      this.#notice("Не удалось скопировать автоматически", true);
    }
  }

  async #openPreview() {
    const message = await this.previewController.getMessage();
    if (!message?.chatId || !message?.messageId || !this.navigation?.openPrivateMessage(message)) {
      this.#notice("Предпросмотр ещё не создан в канале", true);
    }
  }

  #notice(message, error = false) {
    if (!message) return;
    this.events?.emit("ui:toast", {
      message: String(message),
      type: error ? "error" : "info",
      duration: error ? 5200 : 3000
    });
  }

}

function setText(root, selector, text) { const el = root.querySelector(selector); if (el) el.textContent = text; }
function setHidden(root, selector, hidden) { const el = root.querySelector(selector); if (el) el.hidden = Boolean(hidden); }
function setDisabled(root, selector, disabled) { const el = root.querySelector(selector); if (el) el.disabled = Boolean(disabled); }

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatStorageUsage(usage, quota) {
  if (usage == null && quota == null) return "";
  const used = usage == null ? "—" : formatBytes(usage);
  const available = quota == null ? "—" : formatBytes(quota);
  return `Использовано ${used} из ${available}`;
}

function formatBytes(value) {
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let amount = Math.max(0, Number(value) || 0);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}
