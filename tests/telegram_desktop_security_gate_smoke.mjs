import assert from "node:assert/strict";
import { t } from "../js/i18n/index.js?v=1.8.0";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AuthBootstrapController } from "../js/security/AuthBootstrapController.js?v=1.7.5";
import { buildDataCheckString, parseInitData, verifyInitData } from "../js/security/InitDataVerifier.js?v=1.7.5";
import { validateNewPassword } from "../js/security/PasswordPolicy.js?v=1.5.9";
import { CloudStorageAdapter } from "../js/security/CloudStorageAdapter.js?v=1.7.0";
import { TelegramEnvironmentError, TelegramEnvironmentGate } from "../js/security/TelegramEnvironmentGate.js?v=1.7.0";
import { decryptToken, encryptToken } from "../js/security/TokenCrypto.js?v=1.7.0";
import { TOKEN_STORAGE_KEY } from "../js/security/TokenStorageKey.js?v=1.7.0";

const cryptoApi = globalThis.crypto || webcrypto;

await passwordAndKeyTests();
await cryptoContainerTests();
await initDataTests();
await cloudStorageTests();
await cloudStorageEnvironmentDiagnosticsTests();
await controllerTests();
await bootstrapBoundaryTests();

console.log("telegram_desktop_security_gate_smoke: OK");

async function passwordAndKeyTests() {
  assert.equal(validateNewPassword("Пароль123", "Пароль123"), "Пароль123");
  assert.throws(() => validateNewPassword("short1A", "short1A"));
  assert.throws(() => validateNewPassword(" Password1", " Password1"));
  assert.equal(TOKEN_STORAGE_KEY, "rmb_token_v2");
}

async function cryptoContainerTests() {
  const first = await encryptToken({ token: "123456:secret", password: "Пароль123", iterations: 100_000, cryptoApi });
  const second = await encryptToken({ token: "123456:secret", password: "Пароль123", iterations: 100_000, cryptoApi });
  assert.notEqual(first, second, "new salt/IV must rotate ciphertext");
  assert.equal(await decryptToken({ container: first, password: "Пароль123", cryptoApi }), "123456:secret");
  await assert.rejects(decryptToken({ container: first, password: "wrong Password1", cryptoApi }));
  const parsed = JSON.parse(first);
  assert.deepEqual(Object.keys(parsed).sort(), ["cipher", "kdf", "v"]);
  assert.deepEqual(Object.keys(parsed.kdf).sort(), ["iterations", "salt"]);
  assert.deepEqual(Object.keys(parsed.cipher).sort(), ["ciphertext", "iv"]);
  assert.equal(parsed.v, 2);
  assert.equal("publisherBotId" in parsed, false);
  assert.equal("telegramUserId" in parsed, false);
  const containerWithMetadata = JSON.stringify({ ...parsed, publisherBotId: "123456" });
  await assert.rejects(decryptToken({ container: containerWithMetadata, password: "Пароль123", cryptoApi }), { code: "CONTAINER_INVALID" });
}

async function initDataTests() {
  const now = 1_800_000_000_000;
  const signed = await signedMiniAppLaunch({ botId: 777000, userId: 123456789, now });
  const { initData, publicKeyHex } = signed;
  const verified = await verifyInitData(initData, { launcherBotId: 777000, publicKeyHex, now, cryptoApi });
  assert.deepEqual(verified, { telegramUserId: 123456789, authDate: Math.floor(now / 1000) });
  const expired = await signedMiniAppLaunch({ botId: 777000, userId: 123456789, now: now - 31_000 });
  await assert.rejects(
    verifyInitData(expired.initData, { launcherBotId: 777000, publicKeyHex: expired.publicKeyHex, now, cryptoApi }),
    { code: "AUTH_DATE_EXPIRED" }
  );
  const future = await signedMiniAppLaunch({ botId: 777000, userId: 123456789, now: now + 61_000 });
  await assert.rejects(
    verifyInitData(future.initData, { launcherBotId: 777000, publicKeyHex: future.publicKeyHex, now, cryptoApi }),
    { code: "AUTH_DATE_FUTURE" }
  );
  const bridge = {
    getItem(_key, callback) { callback(null, null, false); },
    setItem(_key, _value, callback) { callback(null, true); },
    removeItem(_key, callback) { callback(null, true); },
    getKeys(callback) { callback(null, []); }
  };
  const admitted = await new TelegramEnvironmentGate({
    cryptoApi,
    config: { allowedPlatforms: ["tdesktop"], telegramProductionPublicKeyHex: publicKeyHex },
    windowRoot: { Telegram: { WebApp: { platform: "tdesktop", initData, isVersionAtLeast: version => version === "6.9", CloudStorage: bridge } } }
  }).check();
  assert.equal(admitted.initData, initData, "environment gate keeps initData opaque until getMe establishes the Bot ID");
  await assert.rejects(new TelegramEnvironmentGate({
    cryptoApi,
    config: { allowedPlatforms: ["tdesktop"], telegramProductionPublicKeyHex: publicKeyHex },
    windowRoot: { Telegram: { WebApp: { platform: "weba", initData, isVersionAtLeast: () => true, CloudStorage: bridge } } }
  }).check());
  await assert.rejects(verifyInitData(initData.replace("Test", "Evil"), { launcherBotId: 777000, publicKeyHex, now, cryptoApi }));
  await assert.rejects(verifyInitData(`${initData}&auth_date=1`, { launcherBotId: 777000, publicKeyHex, now, cryptoApi }));
}

async function cloudStorageTests() {
  const values = new Map();
  const bridge = {
    getItem(key, callback) { callback(null, values.get(key) ?? null); },
    setItem(key, value, callback) { values.set(key, value); callback(null, true); },
    removeItem(key, callback) { values.delete(key); callback(null, true); },
    getKeys(callback) { callback(null, [...values.keys()]); }
  };
  const storage = new CloudStorageAdapter(bridge, { timeoutMs: 30 });
  assert.equal(await storage.getItem("missing"), null);
  await storage.setItem("key", "value");
  assert.equal(await storage.getItem("key"), "value");
  assert.deepEqual(await storage.getKeys(), ["key"]);
  await storage.removeItem("key");
}

async function cloudStorageEnvironmentDiagnosticsTests() {
  const now = 1_800_000_000_000;
  const launch = await signedMiniAppLaunch({ botId: 777000, userId: 123456789, now });
  const gateFor = (bridge, cloudStorageTimeoutMs = 30) => new TelegramEnvironmentGate({
    cryptoApi,
    config: { allowedPlatforms: ["tdesktop"], cloudStorageTimeoutMs },
    windowRoot: { Telegram: { WebApp: {
      platform: "tdesktop", initData: launch.initData, isVersionAtLeast: () => true, CloudStorage: bridge
    } } }
  });
  const supportedShape = {
    setItem(_key, _value, callback) { callback(null, true); },
    removeItem(_key, callback) { callback(null, true); },
    getKeys(callback) { callback(null, []); }
  };

  const minimalBridge = {
    getItem(_key, callback) { callback(null, null); },
    setItem(_key, _value, callback) { callback(null, true); },
    removeItem(_key, callback) { callback(null, true); }
  };
  assert.equal((await gateFor(minimalBridge).check()).cloudStorage instanceof CloudStorageAdapter, true,
    "the fixed-key flow must not depend on getKeys");

  await assert.rejects(gateFor({
    getItem(_key, callback) { callback(null, null); },
    removeItem(_key, callback) { callback(null, true); }
  }).check(), error => error instanceof TelegramEnvironmentError
    && error.code === "BLOCKED_CLOUD_STORAGE_UNSUPPORTED");

  await assert.rejects(gateFor({
    ...supportedShape,
    getItem(_key, callback) { callback("UNSUPPORTED"); }
  }).check(), error => error instanceof TelegramEnvironmentError
    && error.code === "BLOCKED_CLOUD_STORAGE_UNSUPPORTED");

  await assert.rejects(gateFor({
    ...supportedShape,
    getItem(_key, callback) { callback("NATIVE_STORAGE_ERROR"); }
  }).check(), error => error instanceof TelegramEnvironmentError
    && error.code === "BLOCKED_CLOUD_STORAGE_ERROR");

  await assert.rejects(gateFor({
    ...supportedShape,
    getItem() { /* Telegram bridge never answered. */ }
  }, 5).check(), error => error instanceof TelegramEnvironmentError
    && error.code === "BLOCKED_CLOUD_STORAGE_TIMEOUT");
}

async function controllerTests() {
  const now = 1_800_000_000_000;
  let securityClock = now;
  const firstLaunch = await signedMiniAppLaunch({ botId: 123456, userId: 42, now });
  const foreignLaunch = await signedMiniAppLaunch({ botId: 123456, userId: 43, now });
  const records = new Map();
  const selectedBotIds = [];
  const db = {
    async selectBot(botId) { selectedBotIds.push(Number(botId)); },
    async get(store, key, fallback = null) { return records.get(`${store}/${key}`) ?? fallback; },
    async put(store, key, value) { records.set(`${store}/${key}`, structuredClone(value)); },
    async all(store) {
      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${store}/`))
        .map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) }));
    }
  };
  const items = new Map();
  const cloudStorage = {
    async getItem(key) { return items.get(key) ?? null; },
    async setItem(key, value) { items.set(key, value); return true; },
    async removeItem(key) { items.delete(key); return true; },
    async getKeys() { return [...items.keys()]; }
  };
  const botIdentityService = { timeoutMs: 1000, async inspectToken(token) {
    if (token !== "123456:secret") throw Object.assign(new Error("invalid"), { errorCode: 401, isAuthError: () => true });
    return { id: 123456, username: "publisher", is_bot: true };
  }, async adoptVerifiedBot(bot) { await db.put("bindings", "botIdentity", { id: bot.id }); } };
  const controllerOptions = launch => ({
    db,
    cloudStorage,
    initData: launch.initData,
    initDataPublicKeyHex: launch.publicKeyHex,
    now: () => securityClock,
    botIdentityService,
    cryptoApi
  });
  const first = new AuthBootstrapController(controllerOptions(firstLaunch));
  assert.equal((await first.prepare()).state, "FIRST_SETUP_PASSWORD");
  assert.deepEqual(selectedBotIds, [], "first setup must not open an unscoped database before getMe establishes Bot ID");
  assert.equal((await first.beginFirstSetup({ password: "Пароль123", confirmation: "Пароль123" })).state, "FIRST_SETUP_TOKEN");
  securityClock += 60_000;
  const completed = await first.finishFirstSetup({ token: "123456:secret" });
  securityClock = now;
  assert.equal(completed.state, "STARTING_APPLICATION");
  assert.deepEqual(selectedBotIds, [123456], "verified getMe Bot ID selects the persistent database");
  assert.deepEqual(completed.telegramContext, { telegramUserId: 42, authDate: Math.floor(now / 1000) });
  assert.equal(records.get("bindings/miniAppUserIdentity").id, 42);
  assert.equal(records.get("bindings/botIdentity").id, 123456);
  const tokenStorageKey = TOKEN_STORAGE_KEY;
  const beforeRotation = items.get(tokenStorageKey);
  assert.deepEqual([...items.keys()], [TOKEN_STORAGE_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(beforeRotation)).sort(), ["cipher", "kdf", "v"]);

  const unreadableRows = new Map();
  const unreadableDb = {
    async get(_store, _key, fallback = null) { return fallback; },
    async put() {},
    async all() { return []; },
    async delete(store, key) { unreadableRows.delete(`${store}/${key}`); }
  };
  const unreadableItems = new Map();
  const unreadableCloudStorage = {
    async getItem(key) { return unreadableItems.get(key) ?? null; },
    async setItem(key, value) { unreadableItems.set(key, value); return true; },
    async removeItem(key) { unreadableItems.delete(key); return true; }
  };
  const unreadable = new AuthBootstrapController({
    ...controllerOptions(firstLaunch),
    db: unreadableDb,
    cloudStorage: unreadableCloudStorage,
    botIdentityService: { timeoutMs: 1000, async inspectToken() { return { id: 123456, is_bot: true }; }, async adoptVerifiedBot() {} }
  });
  assert.equal((await unreadable.prepare()).state, "FIRST_SETUP_PASSWORD");
  await unreadable.beginFirstSetup({ password: "Пароль123", confirmation: "Пароль123" });
  await assert.rejects(unreadable.finishFirstSetup({ token: "123456:secret" }), { code: "CLOUD_STORAGE_WRITE_ERROR" });
  assert.equal(unreadableItems.size, 0, "an unreadable local binding must not leave a new CloudStorage token behind");

  const unlock = new AuthBootstrapController(controllerOptions(firstLaunch));
  assert.equal((await unlock.prepare()).state, "UNLOCK_PASSWORD");
  assert.equal((await unlock.unlock({ password: "Пароль123" })).state, "STARTING_APPLICATION");
  assert.notEqual(items.get(tokenStorageKey), beforeRotation, "successful unlock must rotate encrypted container");

  const futureLaunch = await signedMiniAppLaunch({ botId: 123456, userId: 42, now: now + 61_000 });
  const wrongClock = new AuthBootstrapController(controllerOptions(futureLaunch));
  assert.equal((await wrongClock.prepare()).state, "UNLOCK_PASSWORD");
  await assert.rejects(wrongClock.unlock({ password: "Пароль123" }), {
    code: "BLOCKED_INIT_DATA_TIME_INVALID",
    message: t("security.authBootstrapController.theSystemClockIsBehindTheTelegram")
  });

  const recoveredRecords = new Map();
  const recoveredDb = {
    async get(store, key, fallback = null) { return recoveredRecords.get(`${store}/${key}`) ?? fallback; },
    async put(store, key, value) { recoveredRecords.set(`${store}/${key}`, structuredClone(value)); },
    async all(store) {
      return [...recoveredRecords.entries()]
        .filter(([key]) => key.startsWith(`${store}/`))
        .map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) }));
    }
  };
  const recoveredBotIdentity = {
    ...botIdentityService,
    async adoptVerifiedBot(bot) { await recoveredDb.put("bindings", "botIdentity", { id: bot.id }); }
  };
  const beforeRecoveredRotation = items.get(tokenStorageKey);
  const recovered = new AuthBootstrapController({
    ...controllerOptions(firstLaunch),
    db: recoveredDb,
    botIdentityService: recoveredBotIdentity
  });
  assert.equal((await recovered.prepare()).state, "UNLOCK_PASSWORD", "fixed CloudStorage token key must unlock without an open identity profile");
  assert.equal(recoveredRecords.size, 0, "IndexedDB stays closed until token verification establishes Bot ID");
  assert.equal((await recovered.unlock({ password: "Пароль123" })).state, "STARTING_APPLICATION");
  assert.equal(recoveredRecords.get("bindings/miniAppUserIdentity").id, 42);
  assert.equal(recoveredRecords.get("bindings/botIdentity").id, 123456);
  assert.notEqual(items.get(tokenStorageKey), beforeRecoveredRotation, "recovered unlock must rotate encrypted container without token input");

  const corruptContainer = new AuthBootstrapController({
    ...controllerOptions(firstLaunch),
    db: { ...recoveredDb, async get(_store, _key, fallback = null) { return fallback; }, async all() { return []; } },
    cloudStorage: { ...cloudStorage, async getItem(key) { return key === TOKEN_STORAGE_KEY ? "not-json" : null; } }
  });
  assert.equal((await corruptContainer.prepare()).state, "UNLOCK_PASSWORD");
  assert.equal((await corruptContainer.unlock({ password: "Пароль123" })).state, "RECOVERY_PASSWORD");

  let missingReads = 0;
  const missingRecord = new AuthBootstrapController({
    ...controllerOptions(firstLaunch),
    cloudStorage: {
      ...cloudStorage,
      async getItem(key) {
        missingReads += 1;
        return missingReads === 1 && key === TOKEN_STORAGE_KEY ? items.get(TOKEN_STORAGE_KEY) : null;
      }
    }
  });
  assert.equal((await missingRecord.prepare()).state, "UNLOCK_PASSWORD");
  assert.equal((await missingRecord.unlock({ password: "Пароль123" })).state, "RECOVERY_PASSWORD");

  const wrongPassword = new AuthBootstrapController(controllerOptions(firstLaunch));
  assert.equal((await wrongPassword.prepare()).state, "UNLOCK_PASSWORD");
  assert.equal((await wrongPassword.unlock({ password: "Пароль999" })).state, "RECOVERY_PASSWORD", "invalid ciphertext password starts explicit recovery");

  const rollbackRows = new Map();
  const rollbackDb = {
    async get(_store, _key, fallback = null) { return fallback; },
    async put() { throw new Error("local binding failed"); },
    async all() { return []; },
    async delete(store, key) { rollbackRows.delete(`${store}/${key}`); }
  };
  const rollbackBotIdentity = {
    ...botIdentityService,
    async adoptVerifiedBot() { throw new Error("local binding failed"); }
  };
  const protectedBeforeFailedRecovery = items.get(TOKEN_STORAGE_KEY);
  const rollback = new AuthBootstrapController({
    ...controllerOptions(firstLaunch),
    db: rollbackDb,
    botIdentityService: rollbackBotIdentity
  });
  assert.equal((await rollback.prepare()).state, "UNLOCK_PASSWORD");
  assert.equal((await rollback.unlock({ password: "WrongPassword9" })).state, "RECOVERY_PASSWORD");
  await rollback.beginRecovery({ password: "Recovery123", confirmation: "Recovery123" });
  await assert.rejects(rollback.finishRecovery({ token: "123456:secret" }), { code: "CLOUD_STORAGE_WRITE_ERROR" });
  assert.equal(items.get(TOKEN_STORAGE_KEY), protectedBeforeFailedRecovery, "failed recovery must restore the previous fixed-key ciphertext");

  const foreign = new AuthBootstrapController(controllerOptions(foreignLaunch));
  assert.equal((await foreign.prepare()).state, "UNLOCK_PASSWORD");
  await assert.rejects(foreign.unlock({ password: "Пароль123" }), { code: "BLOCKED_TELEGRAM_USER_MISMATCH" });

  const wrongBotLaunch = await signedMiniAppLaunch({ botId: 654321, userId: 42, now });
  const isolatedRecords = new Map();
  const isolatedDb = {
    async get(store, key, fallback = null) { return isolatedRecords.get(`${store}/${key}`) ?? fallback; },
    async put(store, key, value) { isolatedRecords.set(`${store}/${key}`, structuredClone(value)); },
    async all() { return []; },
    async delete(store, key) { isolatedRecords.delete(`${store}/${key}`); }
  };
  const rejected = new AuthBootstrapController({
    ...controllerOptions(wrongBotLaunch),
    db: isolatedDb,
    cloudStorage: { async getItem() { return null; }, async setItem() { throw new Error("must not persist"); }, async removeItem() {} },
    botIdentityService: { ...botIdentityService, async adoptVerifiedBot() { throw new Error("must not persist"); } }
  });
  assert.equal((await rejected.prepare()).state, "FIRST_SETUP_PASSWORD");
  await rejected.beginFirstSetup({ password: "Пароль123", confirmation: "Пароль123" });
  await assert.rejects(rejected.finishFirstSetup({ token: "123456:secret" }), { code: "BLOCKED_INIT_DATA_INVALID" });
  assert.equal(isolatedRecords.size, 0, "a token must not be stored when its Bot ID cannot verify initData");
}

async function bootstrapBoundaryTests() {
  const [html, bootstrap, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/bootstrap.js", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /<div aria-hidden="true" id="appShell" inert>/);
  assert.match(html, /id="securityGate"/);
  assert.doesNotMatch(html, /src="\.\/js\/app\.js/);
  assert.match(bootstrap, /await import\("\.\/app\.js\?v=1\.7\.16"\)/);
  assert.match(app, /export async function startApplication/);
  assert.doesNotMatch(app, /new AppDatabase\(\)/);
}

async function signedMiniAppLaunch({ botId, userId, now }) {
  const pair = await cryptoApi.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const rawPublic = new Uint8Array(await cryptoApi.subtle.exportKey("raw", pair.publicKey));
  const publicKeyHex = Array.from(rawPublic, byte => byte.toString(16).padStart(2, "0")).join("");
  const plain = `auth_date=${Math.floor(now / 1000)}&user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: "Test" }))}`;
  const signed = buildDataCheckString(parseInitData(plain), botId);
  const signature = new Uint8Array(await cryptoApi.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(signed)));
  return { initData: `${plain}&signature=${Buffer.from(signature).toString("base64url")}`, publicKeyHex };
}
