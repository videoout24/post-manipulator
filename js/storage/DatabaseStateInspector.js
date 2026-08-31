export const MINI_APP_USER_IDENTITY_KEY = "miniAppUserIdentity";
export const PUBLISHER_BOT_IDENTITY_KEY = "botIdentity";

const CONTENT_STORES = Object.freeze([
  "settings", "topics", "preview", "gallery", "thumbnail_cache", "projects",
  "messages", "drafts", "publications", "link_relations"
]);

// Runtime rows are cursors, diagnostics or unfinished temporary sessions. They
// must not convert a new profile into an existing one during security setup.
export class DatabaseStateInspector {
  constructor({ db } = {}) { this.db = db; }

  async inspect(telegramUserId) {
    const [storedUser, storedBot, meaningfulData] = await Promise.all([
      this.db.get("bindings", MINI_APP_USER_IDENTITY_KEY, null),
      this.db.get("bindings", PUBLISHER_BOT_IDENTITY_KEY, null),
      this.hasMeaningfulData()
    ]);
    const userId = validIdentityId(storedUser?.id);
    const botId = validIdentityId(storedBot?.id);
    const malformedUser = storedUser != null && !userId;
    const malformedBot = storedBot != null && !botId;
    const hasData = meaningfulData;
    const requestedUserId = validIdentityId(telegramUserId);

    if (malformedUser || malformedBot) return Object.freeze({ kind: "corrupt", hasData, userId, botId });
    if (userId && requestedUserId && userId !== requestedUserId) return Object.freeze({ kind: "user-mismatch", hasData, userId, botId });
    if (userId && botId) return Object.freeze({ kind: "bound", hasData, userId, botId });
    if (botId) return Object.freeze({ kind: "legacy", hasData, userId: null, botId });
    if (hasData) return Object.freeze({ kind: "data-without-identity", hasData, userId: null, botId: null });
    return Object.freeze({ kind: "new", hasData: false, userId: null, botId: null });
  }

  async hasMeaningfulData({ includeBindings = true } = {}) {
    return (await this.inspectMeaningfulData({ includeBindings })).hasData;
  }

  async inspectMeaningfulData({ includeBindings = true } = {}) {
    const [rows, bindingRows] = await Promise.all([
      Promise.all(CONTENT_STORES.map(store => this.db.all(store))),
      this.db.all("bindings")
    ]);
    const contentRows = rows.flat();
    const customBindingRows = includeBindings
      ? bindingRows.filter(row => ![MINI_APP_USER_IDENTITY_KEY, PUBLISHER_BOT_IDENTITY_KEY].includes(row.key))
      : [];
    const meaningfulRows = [...contentRows, ...customBindingRows];
    const latestUpdatedAt = meaningfulRows.reduce((latest, row) => {
      const updatedAt = Number(row?.updatedAt || 0);
      return Number.isFinite(updatedAt) ? Math.max(latest, updatedAt) : latest;
    }, 0);
    return Object.freeze({ hasData: meaningfulRows.length > 0, latestUpdatedAt });
  }

  async isDatabaseEmpty(options = {}) { return !(await this.hasMeaningfulData(options)); }
}

function validIdentityId(value) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
