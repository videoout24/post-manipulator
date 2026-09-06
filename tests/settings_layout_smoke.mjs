import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../js/app/AppNavigation.js', import.meta.url), 'utf8');
const telegramSettings = fs.readFileSync(new URL('../js/telegram/TelegramSettingsView.js', import.meta.url), 'utf8');

assert(!/data-tab=["']settings["']/.test(html), 'Settings must not appear as a top tab');
assert(/id=["']openSettingsFromBrand["']/.test(html), 'Brand must be the Settings entry point');
assert(/data-settings-section=["']general["']/.test(html), 'General section must exist in left navigation');
assert(/data-settings-panel=["']general["']/.test(html), 'General settings panel must exist');
assert(/class=["'][^"']*settings-sidebar/.test(html), 'Settings left sidebar must exist');
assert(/class=["'][^"']*settings-content/.test(html), 'Settings right content panel must exist');
assert(/class=["'][^"']*settings-cards/.test(html), 'Right settings card stack must exist');
assert.equal((html.match(/id=["']tgRuntimeStatus["']/g) || []).length, 1, 'Runtime status ID must remain unique');
assert(/grid-template-columns:\s*220px\s+minmax\(0,\s*1fr\)/.test(css), 'Settings layout must be two-column');
assert(/\.settings-cards\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css), 'Settings cards must be vertical');
assert(/class="settings-actions settings-runtime-actions"[\s\S]*?id="tgStart"[\s\S]*?id="tgStop"[\s\S]*?id="tgClearWebhook"[\s\S]*?id="tgOpenBotFather"[\s\S]*?<\/div>/.test(html), 'Runtime controls and BotFather must share one ordered row');
assert(/\.settings-runtime-actions\s*\{[^}]*flex-wrap:\s*nowrap/.test(css), 'Runtime controls must stay on one line');
assert(/\.settings-runtime-actions \.settings-action-end\s*\{[^}]*margin-left:\s*auto/.test(css), 'BotFather must align to the right');
assert(/#tgOpenBotFather[\s\S]*?openBot\?\.\("BotFather"\)/.test(telegramSettings), 'BotFather must open through Telegram navigation');
for (const id of ['sseBaseUrl', 'sseProbeStatus', 'sseConnect', 'ssePushTest', 'sseDisconnect']) {
  assert(new RegExp(`id=["']${id}["']`).test(html), `SSE test control ${id} must exist`);
}
assert(/\.connect\(this\.root\.querySelector\("#sseBaseUrl"\)/.test(telegramSettings), 'SSE connection must use the configured base URL');
assert(/\.pushTest\(this\.root\.querySelector\("#sseBaseUrl"\)/.test(telegramSettings), 'Test POST must use the configured base URL');
assert(/this\.#listen\(this\.settingsBrandButton,\s*["']click["'],\s*\(\)\s*=>\s*this\.activateTab\(["']settings["']\)\)/.test(navigation), 'Brand click must activate Settings');

console.log('settings layout smoke: OK');
