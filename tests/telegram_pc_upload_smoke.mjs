import assert from "node:assert/strict";
import { TelegramClient } from "../js/telegram/TelegramClient.js?v=1.5.9";

const scheduled = [];
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return {
    ok: true,
    status: 200,
    async json() { return { ok: true, result: { message_id: 5, photo: [{ file_id: "photo" }] } }; }
  };
};

try {
  const client = new TelegramClient({
    token: "token",
    scheduler: {
      schedule(operation, options) {
        scheduled.push(options);
        return operation();
      }
    }
  });
  const file = new Blob(["pixels"], { type: "image/png" });
  await client.uploadMedia({ chatId: 123, messageThreadId: 9, file, caption: "Caption" });
  assert.deepEqual(scheduled[0], { chatId: 123 });
  assert.match(requests[0].url, /\/sendPhoto$/);
  assert(requests[0].options.body instanceof FormData);
  assert.equal(requests[0].options.body.get("chat_id"), "123");
  assert.equal(requests[0].options.body.get("message_thread_id"), "9");
  assert.equal(requests[0].options.body.get("caption"), "Caption");
  assert(requests[0].options.body.get("photo") instanceof Blob);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("telegram_pc_upload_smoke: OK");
