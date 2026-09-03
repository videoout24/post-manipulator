import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { TelegramApiError, TelegramClient } from "../js/telegram/TelegramClient.js?v=1.8.1";

const originalFetch = globalThis.fetch;
const events = new EventBus();
const activity = [];
for (const name of [
  "telegram:request-start",
  "telegram:request-end",
  "telegram:request-success",
  "telegram:request-network-error"
]) events.on(name, payload => activity.push([name, payload]));

let calls = 0;
globalThis.fetch = async (_url, { signal } = {}) => {
  calls += 1;
  if (calls === 1) {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  }
  return {
    ok: true,
    status: 200,
    async json() { return { ok: true, result: { message_id: 22 } }; }
  };
};

try {
  const client = new TelegramClient({ token: "token", events, requestTimeoutMs: 15 });
  const blocked = client.sendRichMessage({ chatId: -1001, richMessage: { text: "first" } })
    .catch(error => error);
  const following = client.sendRichMessage({ chatId: -1002, richMessage: { text: "second" } });

  const timeoutError = await blocked;
  assert(timeoutError instanceof TelegramApiError);
  assert.equal(timeoutError.isTimeout(), true);
  assert.equal(timeoutError.method, "sendRichMessage");
  assert.equal((await following).message_id, 22, "the request after a timeout must leave the shared queue");
  assert.equal(calls, 2);

  assert.deepEqual(activity.map(([name]) => name), [
    "telegram:request-start",
    "telegram:request-network-error",
    "telegram:request-end",
    "telegram:request-start",
    "telegram:request-success",
    "telegram:request-end"
  ]);
  assert.equal(activity[1][1].timedOut, true);

  calls = 0;
  globalThis.fetch = async (_url, { signal } = {}) => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const error = new Error("body aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        })
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, result: { message_id: 44 } }; }
    };
  };

  const bodyClient = new TelegramClient({ token: "token", requestTimeoutMs: 15 });
  const blockedBody = bodyClient.sendRichMessage({ chatId: -1003, richMessage: { text: "body" } })
    .catch(error => error);
  const afterBody = bodyClient.sendRichMessage({ chatId: -1004, richMessage: { text: "after body" } });
  assert.equal((await blockedBody).isTimeout(), true, "a stalled response body must also time out");
  assert.equal((await afterBody).message_id, 44, "a stalled response body must not poison the queue");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("telegram_request_timeout_smoke: OK");
