import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../js/app/AppNavigation.js', import.meta.url), 'utf8');

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
assert(/this\.#listen\(this\.settingsBrandButton,\s*["']click["'],\s*\(\)\s*=>\s*this\.activateTab\(["']settings["']\)\)/.test(navigation), 'Brand click must activate Settings');

console.log('settings layout smoke: OK');
