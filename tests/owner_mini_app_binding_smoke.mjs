import assert from "node:assert/strict";
import { OwnerBindingService } from "../js/telegram/OwnerBindingService.js?v=1.6.5";

const records = new Map();
const events = [];
const db = {
  async get(store, key, fallback = null) { return records.get(`${store}/${key}`) ?? fallback; },
  async put(store, key, value) { records.set(`${store}/${key}`, structuredClone(value)); },
  async delete(store, key) { records.delete(`${store}/${key}`); }
};
const ownerBinding = new OwnerBindingService({ db, events: { emit: (name, value) => events.push([name, value]) } });

const owner = await ownerBinding.bindVerifiedMiniAppUser(123456789);
assert.deepEqual(owner, {
  userId: 123456789,
  chatId: 123456789,
  username: "",
  firstName: "",
  boundAt: owner.boundAt,
  source: "verified_mini_app"
});
assert.deepEqual(await ownerBinding.getOwner(), {
  userId: 123456789,
  chatId: 123456789,
  username: "",
  firstName: "",
  boundAt: owner.boundAt,
  source: "verified_mini_app"
});
assert.equal((await ownerBinding.bindVerifiedMiniAppUser(123456789)).boundAt, owner.boundAt);
await assert.rejects(ownerBinding.bindVerifiedMiniAppUser(987654321), /другому владельцу/);
assert.deepEqual(await ownerBinding.handleUpdate({ update_id: 5 }), { handled: false, updateId: 5 });
assert.equal(events.filter(([name]) => name === "telegram:owner-bound").length, 1);

console.log("owner_mini_app_binding_smoke: OK");
