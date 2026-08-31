import assert from "node:assert/strict";
import { BotIdentityMismatchError, BotIdentityService } from "../js/telegram/BotIdentityService.js?v=1.5.9";

const rows = new Map([["bindings:botIdentity", { id: "42", username: "must_not_persist" }]]);
const events = [];
const db = {
  async get(store, key, fallback = null) { return rows.get(`${store}:${key}`) ?? fallback; },
  async put(store, key, value) { rows.set(`${store}:${key}`, structuredClone(value)); }
};
const client = {
  hasToken: () => true,
  async getMe() { return { id: 42, username: "session_bot", first_name: "Session" }; }
};
const service = new BotIdentityService({ db, client, events: { emit: (name, payload) => events.push({ name, payload }) } });

assert.deepEqual(await service.initialize(), { id: 42 });
assert.deepEqual(rows.get("bindings:botIdentity"), { id: 42 }, "only bot ID may persist");

const verified = await service.verifyCurrentClient();
assert.equal(verified.username, "session_bot");
assert.deepEqual(rows.get("bindings:botIdentity"), { id: 42 }, "getMe display data must remain in memory");
assert.equal(events.at(-1).payload.username, "session_bot", "session consumers still receive verified bot details");

await assert.rejects(
  () => service.assertMatches({ id: 99, username: "other_bot" }),
  error => error instanceof BotIdentityMismatchError && error.expectedId === 42 && error.actualName === "@other_bot"
);

console.log("bot_session_identity_smoke: OK");
