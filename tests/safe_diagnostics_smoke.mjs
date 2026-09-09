import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeErrorDetails } from "../js/core/SafeDiagnostics.js";
import { TelegramApiError } from "../js/telegram/TelegramClient.js";

const token = "123456789:TEST_SECRET_TOKEN_FOR_DIAGNOSTICS";
const error = Object.assign(new Error(`https://api.telegram.org/bot${token}/sendPhoto`, {
  cause: new Error(`Request URL contains ${token}`)
}), {
  method: "sendPhoto", errorCode: 400, timedOut: true,
  description: token, parameters: { token }, payload: { secret: token }, token
});
const safe = safeErrorDetails(error);
assert.deepEqual(safe, { method: "sendPhoto", code: 400, timedOut: true });
assert.equal(JSON.stringify(safe).includes(token), false);
assert.equal(safe instanceof Error, false);
assert.deepEqual(safeErrorDetails({ method: token, errorCode: token, cause: error }), {});
assert.deepEqual(safeErrorDetails(null), {});
const apiError = new TelegramApiError(`Request failed: https://api.telegram.org/bot${token}/sendPhoto`, {
  description: `Bad Request: ${token}`, cause: error, method: "sendPhoto", errorCode: 400
});
assert.equal(apiError.cause, undefined);
assert.equal(apiError.message.includes(token), false);
assert.equal(apiError.description.includes(token), false);
assert.equal(apiError.stack.includes(token), false);
for (const path of ["js/bootstrap.js", "js/gallery/GalleryView.js", "js/telegram/TelegramSettingsView.js", "js/app/AppLifecycle.js", "js/project/ProjectPostCard.js", "js/editor/TreeView.js", "js/storage/Storage.js", "js/core/MetaBlockRegistry.js"]) {
  const source = await readFile(path, "utf8");
  assert.doesNotMatch(source, /(?:console|this\.logger)\.(?:error|warn)\([^;\n]*,\s*error\s*\)/, `${path} must not log raw error objects`);
  assert.doesNotMatch(source, /console\.(?:error|warn)\(error\)/);
}
console.log("safe_diagnostics_smoke: OK");
