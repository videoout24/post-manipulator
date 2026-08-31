import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../js/telegram/TelegramClient.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(html, /class="topbar-network" id="appNetPanel"/, "NetPanel must live in the global topbar");
assert.match(app, /new NetPanel\(/);
assert.match(app, /editorActive \? \{ \.\.\.\(payload \|\| \{\}\), silent: true \} : payload/);
assert.match(app, /telegram:runtime-status/);
assert.match(app, /telegram:request-start/);
assert.match(app, /window\.addEventListener\("online"/);
assert.match(app, /inlineWhen:[\s\S]*?data-tab=\\?"editor/);
assert.match(app, /state === "retrying" \|\| state === "error"/);
assert.match(client, /method !== "getUpdates"/, "Long polling must use its own indicator instead of request activity");
assert.match(client, /telegram:request-start/);
assert.match(client, /telegram:request-end/);
assert.match(client, /telegram:request-success/);
assert.match(client, /telegram:request-network-error/);
assert.match(app, /!netPanel\.isPollingEnabled\(\)\) telegramConnectionAvailable = true/);
assert.match(fs.readFileSync(new URL("../js/app/NetPanel.js", import.meta.url), "utf8"), /net-panel--polling-paused/);
assert.match(css, /\.net-panel--offline \.net-panel__triangle\s*\{[^}]*color:\s*var\(--net-panel-error\)/);

console.log("net_panel_integration_smoke: OK");
