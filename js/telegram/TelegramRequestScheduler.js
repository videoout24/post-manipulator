const GLOBAL_LIMIT = 29;
const GLOBAL_WINDOW_MS = 500;
const PRIVATE_CHAT_INTERVAL_MS = 500;
const GROUP_CHAT_INTERVAL_MS = 500;

export class TelegramRequestScheduler {
  constructor({ now = () => Date.now(), delay = wait } = {}) {
    this.now = now;
    this.delay = delay;
    this.queue = [];
    this.coalesced = new Map();
    this.recentStarts = [];
    this.chatAvailableAt = new Map();
    this.running = false;
    this.blockedUntil = 0;
  }

  schedule(operation, { chatId = null, coalesceKey = "" } = {}) {
    const key = String(coalesceKey || "");
    const existing = key ? this.coalesced.get(key) : null;
    if (existing) {
      existing.operation = operation;
      return new Promise((resolve, reject) => existing.waiters.push({ resolve, reject }));
    }

    const entry = {
      operation,
      chatId: chatId == null ? null : Number(chatId),
      key,
      waiters: [],
      attempts: 0
    };
    const promise = new Promise((resolve, reject) => entry.waiters.push({ resolve, reject }));
    this.queue.push(entry);
    if (key) this.coalesced.set(key, entry);
    this.#drain();
    return promise;
  }

  async #drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const entry = this.queue.shift();
        if (entry.key && this.coalesced.get(entry.key) === entry) this.coalesced.delete(entry.key);
        await this.#waitForCapacity(entry.chatId);
        this.#recordStart(entry.chatId);
        try {
          const result = await entry.operation();
          for (const waiter of entry.waiters) waiter.resolve(result);
        } catch (error) {
          const retryAfter = Number(error?.parameters?.retry_after || 0);
          if (Number(error?.errorCode) === 429 && retryAfter > 0 && entry.attempts < 5) {
            entry.attempts += 1;
            this.blockedUntil = Math.max(this.blockedUntil, this.now() + retryAfter * 1000);
            this.queue.unshift(entry);
            if (entry.key) this.coalesced.set(entry.key, entry);
            continue;
          }
          for (const waiter of entry.waiters) waiter.reject(error);
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length) this.#drain();
    }
  }

  async #waitForCapacity(chatId) {
    while (true) {
      const now = this.now();
      this.recentStarts = this.recentStarts.filter(startedAt => startedAt > now - GLOBAL_WINDOW_MS);
      const globalAt = this.recentStarts.length >= GLOBAL_LIMIT
        ? this.recentStarts[0] + GLOBAL_WINDOW_MS
        : now;
      const chatAt = chatId == null ? now : Number(this.chatAvailableAt.get(chatId) || 0);
      const readyAt = Math.max(now, this.blockedUntil, globalAt, chatAt);
      if (readyAt <= now) return;
      await this.delay(readyAt - now);
    }
  }

  #recordStart(chatId) {
    const now = this.now();
    this.recentStarts.push(now);
    if (chatId == null) return;
    const interval = chatId < 0 ? GROUP_CHAT_INTERVAL_MS : PRIVATE_CHAT_INTERVAL_MS;
    this.chatAvailableAt.set(chatId, now + interval);
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
}

