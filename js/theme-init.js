// This small, synchronous entry runs before the stylesheet and the security gate.
// Keep its preference resolution aligned with core/ThemePreferences.js.
(() => {
  let preference = "dark";
  try {
    const stored = globalThis.localStorage?.getItem("postManipulatorTheme");
    if (["dark", "light", "auto"].includes(stored)) preference = stored;
  } catch { /* The default remains usable when storage is blocked. */ }
  let theme = preference;
  if (theme === "auto") {
    const telegramTheme = globalThis.Telegram?.WebApp?.colorScheme;
    theme = telegramTheme === "light" || telegramTheme === "dark" ? telegramTheme : "dark";
    if (telegramTheme !== "light" && telegramTheme !== "dark") {
      try { theme = globalThis.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch {}
    }
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
