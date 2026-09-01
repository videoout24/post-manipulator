import { t } from "../i18n/index.js?v=1.8.0";
const OWNER_KEY = "owner";

export class OwnerBindingService {
  constructor({ db, events }) {
    this.db = db;
    this.events = events;
  }

  getOwner() { return this.db.get("bindings", OWNER_KEY, null); }

  /**
   * The security gate verifies initData before this method runs. A private bot
   * chat has the same numeric ID as its Telegram user, so no /start payload is
   * required to establish ownership of the local workspace.
   */
  async bindVerifiedMiniAppUser(telegramUserId) {
    const userId = validTelegramUserId(telegramUserId);
    if (!userId) throw new Error(t("telegram.ownerBindingService.telegramDidNotConfirmMiniAppOwner"));
    const existing = await this.getOwner();
    if (existing) {
      if (Number(existing.userId) === userId) return existing;
      throw new Error(t("telegram.ownerBindingService.thisLocalDatabaseIsAlreadyBoundTo"));
    }
    const owner = {
      userId,
      chatId: userId,
      username: "",
      firstName: "",
      boundAt: Date.now(),
      source: "verified_mini_app"
    };
    await this.db.put("bindings", OWNER_KEY, owner);
    this.events?.emit("telegram:owner-bound", owner);
    return owner;
  }

  async handleUpdate(update) {
    // Ownership is established from signed initData before runtime starts.
    // Keep this API for TelegramRuntime's ordered update pipeline.
    return { handled: false, updateId: Number(update?.update_id || 0) || null };
  }

  async unbind() {
    await this.db.delete("bindings", OWNER_KEY);
    this.events?.emit("telegram:owner-unbound", {});
  }
}

function validTelegramUserId(value) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
