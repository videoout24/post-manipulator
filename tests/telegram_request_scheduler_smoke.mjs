import assert from "node:assert/strict";
import { TelegramRequestScheduler } from "../js/telegram/TelegramRequestScheduler.js?v=1.5.9";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

{
  const scheduler = new TelegramRequestScheduler();
  const gate = deferred();
  const blocker = scheduler.schedule(() => gate.promise);
  let staleRuns = 0;
  let latestRuns = 0;
  const stale = scheduler.schedule(async () => { staleRuns += 1; return "stale"; }, { chatId: 7, coalesceKey: "edit:7:1" });
  const latest = scheduler.schedule(async () => { latestRuns += 1; return "latest"; }, { chatId: 7, coalesceKey: "edit:7:1" });
  gate.resolve("released");
  assert.equal(await blocker, "released");
  assert.deepEqual(await Promise.all([stale, latest]), ["latest", "latest"]);
  assert.equal(staleRuns, 0);
  assert.equal(latestRuns, 1);
}

{
  let now = 0;
  const delays = [];
  const scheduler = new TelegramRequestScheduler({
    now: () => now,
    delay: async milliseconds => { delays.push(milliseconds); now += milliseconds; }
  });
  await Promise.all([
    scheduler.schedule(async () => 1, { chatId: 10 }),
    scheduler.schedule(async () => 2, { chatId: 10 })
  ]);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] > 0, "Requests for one chat must be separated by a positive interval");
}

{
  let now = 0;
  let attempts = 0;
  const scheduler = new TelegramRequestScheduler({
    now: () => now,
    delay: async milliseconds => { now += milliseconds; }
  });
  const result = await scheduler.schedule(async () => {
    attempts += 1;
    if (attempts === 1) throw { errorCode: 429, parameters: { retry_after: 2 } };
    return "retried";
  });
  assert.equal(result, "retried");
  assert.equal(now, 2000);
  assert.equal(attempts, 2);
}

console.log("telegram_request_scheduler_smoke: OK");
