import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../js/telegram/TelegramRuntime.js", import.meta.url), "utf8");

assert.match(runtime, /if \(this\.startPromise\) return this\.startPromise/);
assert.match(runtime, /this\.startPromise = this\.#startRuntime\(\)/);
assert.match(runtime, /error\.isAuthError\(\)[\s\S]*?break/);
assert.doesNotMatch(runtime, /error\.isAuthError\(\) \|\| error\.isConflict\(\)/);
assert.match(runtime, /t\("telegram\.telegramRuntime\.getupdatesConflictRetryingInWith"/);
assert.match(runtime, /finally \{[\s\S]*?this\.serviceMessages\?\.handleUpdate\?\.\(update\)/);
assert.doesNotMatch(runtime, /#logMediaUpdate|private media update|console\.(?:info|log|debug)/,
  "verbose Telegram update logging must stay disabled");

console.log("telegram runtime single start contract smoke: OK");
