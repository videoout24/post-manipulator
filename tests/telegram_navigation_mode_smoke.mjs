import assert from 'node:assert/strict';
import { TelegramNavigation } from '../js/telegram/TelegramNavigation.js?v=1.7.1';

const clicks = [];
const fakeDocument = {
  body: { append() {} },
  createElement() {
    return {
      href: '', target: '', rel: '', style: {},
      click() { clicks.push({ href: this.href, target: this.target }); },
      remove() {}
    };
  }
};
const store = new Map([['settings:telegramNativeIntegration', true]]);
const db = {
  async get(storeName, key, fallback) { return store.get(`${storeName}:${key}`) ?? fallback; },
  async put(storeName, key, value) { store.set(`${storeName}:${key}`, value); return value; }
};
const telegramLinks = [];
const externalLinks = [];
const webApp = {
  openTelegramLink(url) { telegramLinks.push(url); },
  openLink(url) { externalLinks.push(url); }
};
const nav = new TelegramNavigation({ db, documentRef: fakeDocument, webApp, botIdentity: { async getIdentity() { return { id: 1, username: 'publisher_bot' }; } } });
await nav.initialize();
nav.openBotStart({ token: 'owner-token' });
assert.equal(telegramLinks.at(-1), 'https://t.me/publisher_bot?start=owner-token');
nav.openPrivateMessage({ chatId: -1001234567890, messageId: 10 });
assert.equal(telegramLinks.at(-1), 'https://t.me/c/1234567890/10');
nav.openBot('BotFather');
assert.equal(telegramLinks.at(-1), 'https://t.me/BotFather');
assert.equal(clicks.length, 0, 'Mini App navigation must use Telegram.WebApp instead of synthetic links');
await nav.setNativeIntegration(false);
nav.openBotStart({ token: 'owner-token' });
assert.equal(externalLinks.at(-1), 'https://t.me/publisher_bot?start=owner-token');
nav.openPrivateMessage({ chatId: -1001234567890, messageId: 10 });
assert.equal(externalLinks.at(-1), 'https://t.me/c/1234567890/10');

store.set('settings:telegramNativeIntegration', true);
const fallback = new TelegramNavigation({ db, documentRef: fakeDocument, webApp: null });
await fallback.initialize();
fallback.openPrivateMessage({ chatId: -1001234567890, messageId: 11 });
assert.equal(clicks.at(-1).href, 'tg://privatepost?channel=1234567890&post=11');
assert.equal(clicks.at(-1).target, '', 'tg:// fallback must stay in the current WebView context');
console.log('telegram_navigation_mode_smoke: OK');
