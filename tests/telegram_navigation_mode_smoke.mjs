import assert from 'node:assert/strict';
import { TelegramNavigation } from '../js/telegram/TelegramNavigation.js?v=1.5.9';

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
const nav = new TelegramNavigation({ db, documentRef: fakeDocument, botIdentity: { async getIdentity() { return { id: 1, username: 'publisher_bot' }; } } });
await nav.initialize();
nav.openBotStart({ token: 'owner-token' });
assert.equal(clicks.at(-1).href, 'tg://resolve?domain=publisher_bot&start=owner-token');
assert.equal(clicks.at(-1).target, '_blank');
nav.openPrivateMessage({ chatId: -1001234567890, messageId: 10 });
assert.equal(clicks.at(-1).href, 'tg://privatepost?channel=1234567890&post=10');
assert.equal(clicks.at(-1).target, '_blank');
await nav.setNativeIntegration(false);
nav.openBotStart({ token: 'owner-token' });
assert.equal(clicks.at(-1).href, 'https://t.me/publisher_bot?start=owner-token');
assert.equal(clicks.at(-1).target, '_blank');
nav.openPrivateMessage({ chatId: -1001234567890, messageId: 10 });
assert.equal(clicks.at(-1).href, 'https://t.me/c/1234567890/10');
assert.equal(clicks.at(-1).target, '_blank');
console.log('telegram_navigation_mode_smoke: OK');
