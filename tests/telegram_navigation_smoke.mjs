import assert from 'node:assert/strict';
import {
  buildBotLinks,
  buildBotStartLinks,
  buildPrivateMessageCommentsLinks,
  buildPrivateMessageLinks,
  buildPublicMessageCommentsLinks,
  buildPublicMessageLinks,
  privateChannelInternalId
} from '../js/telegram/TelegramNavigation.js?v=1.5.9';

assert.deepEqual(buildBotLinks('@publisher_bot'), {
  nativeUrl: 'tg://resolve?domain=publisher_bot',
  webUrl: 'https://t.me/publisher_bot'
});
assert.deepEqual(buildBotStartLinks('@publisher_bot', 'bind token'), {
  nativeUrl: 'tg://resolve?domain=publisher_bot&start=bind%20token',
  webUrl: 'https://t.me/publisher_bot?start=bind%20token'
});
assert.equal(privateChannelInternalId(-1001234567890), '1234567890');
assert.deepEqual(buildPrivateMessageLinks(-1001234567890, 42), {
  nativeUrl: 'tg://privatepost?channel=1234567890&post=42',
  webUrl: 'https://t.me/c/1234567890/42'
});
assert.deepEqual(buildPublicMessageLinks('channel_name', 77), {
  nativeUrl: 'tg://resolve?domain=channel_name&post=77',
  webUrl: 'https://t.me/channel_name/77'
});
assert.deepEqual(buildPublicMessageCommentsLinks('@channel_name', 77, 91), {
  nativeUrl: 'tg://resolve?domain=channel_name&post=77&comment=91',
  webUrl: 'https://t.me/channel_name/77?comment=91'
});
assert.deepEqual(buildPrivateMessageCommentsLinks(-1001234567890, 42, 91), {
  nativeUrl: 'tg://privatepost?channel=1234567890&post=42&comment=91',
  webUrl: 'https://t.me/c/1234567890/42?comment=91'
});
assert.deepEqual(buildPrivateMessageCommentsLinks(-1001234567890, 42, 0), { nativeUrl: '', webUrl: '' });
assert.deepEqual(buildPrivateMessageLinks(-123, 42), { nativeUrl: '', webUrl: '' });
console.log('telegram_navigation_smoke: OK');
