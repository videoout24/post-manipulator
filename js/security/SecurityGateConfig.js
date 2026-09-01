// No Bot ID is configured at deploy time. On zero setup, getMe first proves
// the entered token and its Bot ID then verifies the Telegram signed initData.
export const SECURITY_GATE_CONFIG = Object.freeze({
  allowedPlatforms: Object.freeze(["tdesktop"]),
  maxInitDataAgeSec: 30,
  maxClockSkewSec: 60,
  cloudStorageTimeoutMs: 12_000,
  botApiTimeoutMs: 30_000,
  telegramProductionPublicKeyHex: "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"
});
