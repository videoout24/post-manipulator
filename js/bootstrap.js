import { applyDocumentTranslations, getLocale, t } from "./i18n/index.js?v=1.8.0";
import { AppDatabase } from "./storage/AppDatabase.js?v=1.7.1";
import { TelegramBackupService } from "./storage/TelegramBackupService.js?v=1.7.2";
import { BotIdentityService } from "./telegram/BotIdentityService.js?v=1.5.9";
import { OwnerBindingService } from "./telegram/OwnerBindingService.js?v=1.5.9";
import { TelegramClient } from "./telegram/TelegramClient.js?v=1.5.9";
import { TelegramViewportController } from "./telegram/TelegramViewportController.js?v=1.7.5";
import { AuthBootstrapController, AuthBootstrapError } from "./security/AuthBootstrapController.js?v=1.7.15";
import { SECURITY_GATE_CONFIG } from "./security/SecurityGateConfig.js?v=1.7.5";
import { SecurityGateView } from "./security/SecurityGateView.js?v=1.7.15";
import { TelegramEnvironmentGate, TelegramEnvironmentError } from "./security/TelegramEnvironmentGate.js?v=1.7.0";
import { confirmDarkDialog } from "./core/DarkDialog.js?v=1.6.5";

const documentRoot = globalThis.document;
applyDocumentTranslations(documentRoot);
const appShell = documentRoot?.querySelector?.("#appShell");
const gateView = new SecurityGateView({ root: documentRoot?.querySelector?.("#securityGate") });
const manualBackupRecovery = backupRecoveryRequested();

// The main module is intentionally absent from the static import graph. It is
// dynamically imported only after a verified Telegram session unlocks a token.
void bootstrapSecurityGate();

async function bootstrapSecurityGate() {
  let appDb = null;
  let controller = null;
  let application = null;
  let bootstrapStage = "environment";
  let telegramWebApp = null;
  gateView.show("CHECKING_ENVIRONMENT");
  const earlyWebApp = globalThis.window?.Telegram?.WebApp;
  gateView.setWebApp(earlyWebApp);
  try { earlyWebApp?.ready?.(); } catch { /* a broken bridge stays fail-closed below */ }

  try {
    const environment = await new TelegramEnvironmentGate({ config: SECURITY_GATE_CONFIG }).check();
    telegramWebApp = environment.webApp;
    gateView.setWebApp(environment.webApp, { canCloseMiniApp: true });
    const viewport = new TelegramViewportController({ webApp: environment.webApp }).start();
    console.info("[Post Manipulator] Telegram viewport ready", viewport);
    appDb = new AppDatabase();
    gateView.show("OPENING_DATABASE");
    bootstrapStage = "authorization";
    const botIdentityService = new BotIdentityService({ db: appDb });
    botIdentityService.timeoutMs = SECURITY_GATE_CONFIG.botApiTimeoutMs;
    controller = new AuthBootstrapController({
      db: appDb,
      cloudStorage: environment.cloudStorage,
      initData: environment.initData,
      initDataPublicKeyHex: SECURITY_GATE_CONFIG.telegramProductionPublicKeyHex,
      maxInitDataAgeSec: SECURITY_GATE_CONFIG.maxInitDataAgeSec,
      maxClockSkewSec: SECURITY_GATE_CONFIG.maxClockSkewSec,
      botIdentityService
    });
    bindController(controller, result => continueFromResult(result));
    await continueFromResult(await controller.prepare());
  } catch (error) {
    logBootstrapFailure(bootstrapStage, error);
    gateView.show(stateForError(error), { message: safeMessage(error) });
    controller?.clearSensitiveState?.();
    await appDb?.close?.().catch(() => {});
  }

  async function continueFromResult(result) {
    if (!result?.state) return;
    if (result.state !== "STARTING_APPLICATION") {
      gateView.show(result.state, result);
      return;
    }
    gateView.show("STARTING_APPLICATION");
    try {
      if (!appDb?.info || appDb.info.engine !== "indexeddb") {
        throw new AuthBootstrapError("DATABASE_ERROR", t("bootstrap.indexeddbOfTheSelectedBotWasNot"));
      }
      console.info("[Post Manipulator] Bot database ready", {
        engine: appDb.info.engine,
        databaseName: appDb.info.databaseName,
        botId: appDb.botId,
        persistent: appDb.info.persistent === true
      });
      bootstrapStage = "backup-recovery";
      await recoverBackupBeforeApplication({
        appDb,
        token: result.token,
        verifiedBot: result.verifiedBot,
        telegramContext: result.telegramContext,
        telegramWebApp,
        manual: manualBackupRecovery
      });
      bootstrapStage = "application";
      const { startApplication } = await import("./app.js?v=1.7.17");
      application = await startApplication({
        appDb,
        token: result.token,
        verifiedBot: result.verifiedBot,
        telegramContext: result.telegramContext
      });
      await application.start();
      unlockApplicationShell();
      controller.clearSensitiveState();
    } catch (error) {
      application?.stop?.();
      gateView.show("DATABASE_ERROR", { message: t("bootstrap.theMainApplicationWasNotLaunchedData") });
      controller.clearSensitiveState();
      await appDb?.close?.().catch(() => {});
      // Keep the detailed error off screen: it can include third-party payloads.
      console.error("Application startup failed after security gate", error);
    }
  }
}

async function recoverBackupBeforeApplication({ appDb, token, verifiedBot, telegramContext, telegramWebApp, manual = false } = {}) {
  const ownerBinding = new OwnerBindingService({ db: appDb });
  const owner = await ownerBinding.bindVerifiedMiniAppUser(telegramContext?.telegramUserId);
  const client = new TelegramClient({ token });
  const backups = new TelegramBackupService({ db: appDb, client, ownerBinding });
  let inspection = null;
  let inspectionError = null;
  const state = documentRoot?.querySelector?.("#telegramBackupState");
  if (state) state.textContent = t("app.checkingTheLatestPinnedCopy");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try { inspection = await backups.inspectPinnedBackup(owner, { signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    renderBackupInspection(state, inspection);
  } catch (error) {
    inspectionError = error;
    if (state) state.textContent = t("bootstrap.failedToCheckThePinnedCopyManual");
    console.warn("Pinned backup discovery before application startup failed", error);
  }

  const shouldPrompt = manual || inspection?.shouldOfferRestore === true;
  if (!shouldPrompt) {
    client.clearToken();
    return Object.freeze({ restored: false, inspection, inspectionError });
  }

  clearBackupRecoveryRequest();
  try {
    const restored = await showBackupRecoveryDialog({
      backups,
      inspection,
      inspectionError,
      verifiedBot,
      telegramWebApp,
      manual
    });
    if (restored) {
      // A backup replaces every record, including bindings. Re-assert the
      // verified Mini App owner before any application service is constructed.
      await ownerBinding.bindVerifiedMiniAppUser(telegramContext?.telegramUserId);
      if (state) state.textContent = t("bootstrap.backupRestoredInTheCurrentProtectedRun");
    }
    return Object.freeze({ restored, inspection, inspectionError });
  } finally {
    client.clearToken();
  }
}

function showBackupRecoveryDialog({ backups, inspection, inspectionError, verifiedBot, telegramWebApp, manual = false } = {}) {
  const dialog = documentRoot?.querySelector?.("#telegramBackupRestoreDialog");
  const title = documentRoot?.querySelector?.("#telegramBackupRestoreTitle");
  const hint = documentRoot?.querySelector?.("#telegramBackupRestoreHint");
  const fileInput = documentRoot?.querySelector?.("#telegramBackupRestoreFile");
  const applyButton = documentRoot?.querySelector?.("#telegramBackupRestoreApply");
  const openButton = documentRoot?.querySelector?.("#telegramBackupRestoreOpen");
  const skipButton = documentRoot?.querySelector?.("#telegramBackupRestoreSkip");
  if (!dialog || !hint || !fileInput || !applyButton || !skipButton) return Promise.resolve(false);

  const backup = inspection?.backup || null;
  const username = String(verifiedBot?.username || "").replace(/^@/, "");
  if (title) title.textContent = inspection?.shouldOfferRestore ? t("bootstrap.aNewerCopyWasFound") : t("bootstrap.manualRecovery");
  hint.textContent = backup
    ? t("bootstrap.theNewestPinnedCopySubmissionDate", { 0: backup.document?.file_name || "backup.json", 1: formatBackupDate(backup.createdAt) })
    : inspectionError
      ? t("bootstrap.failedToVerifyThePinYouCan")
      : manual
        ? t("bootstrap.selectAPreviouslyDownloadedPostManipulatorBackup")
        : t("bootstrap.selectAPostManipulatorBackup");
  fileInput.value = "";
  if (openButton) openButton.disabled = !username;

  return new Promise(resolve => {
    let completed = false;
    const finish = restored => {
      if (completed) return;
      completed = true;
      cleanup();
      if (dialog.open) dialog.close(restored ? "restored" : "skip");
      resolve(restored);
    };
    const onClose = () => finish(dialog.returnValue === "restored");
    const onSkip = () => finish(false);
    const onOpen = () => {
      if (!username) return;
      const url = `https://t.me/${username}`;
      if (typeof telegramWebApp?.openTelegramLink === "function") telegramWebApp.openTelegramLink(url);
      else if (typeof telegramWebApp?.openLink === "function") telegramWebApp.openLink(url);
      else globalThis.open?.(url, "_blank", "noopener,noreferrer");
    };
    const onApply = async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        hint.textContent = t("bootstrap.firstSelectADownloadedJSONBackupFile");
        return;
      }
      if (!await confirmDarkDialog({
        title: t("bootstrap.replaceTheLocalDatabase"),
        message: t("bootstrap.allCurrentProjectsDraftsSettingsAndLocal"),
        confirmLabel: t("bootstrap.restore"),
        danger: true
      })) return;
      applyButton.disabled = true;
      try {
        await backups.restoreDownloadedFile(file, { sourceBackup: backup });
        finish(true);
      } catch (error) {
        hint.textContent = t("bootstrap.recoveryNotCompleted", { 0: error?.message || error });
      } finally {
        applyButton.disabled = false;
      }
    };
    const cleanup = () => {
      dialog.removeEventListener("close", onClose);
      skipButton.removeEventListener("click", onSkip);
      openButton?.removeEventListener("click", onOpen);
      applyButton.removeEventListener("click", onApply);
    };
    dialog.addEventListener("close", onClose);
    skipButton.addEventListener("click", onSkip);
    openButton?.addEventListener("click", onOpen);
    applyButton.addEventListener("click", onApply);
    if (!dialog.open) dialog.showModal();
  });
}

function renderBackupInspection(state, inspection) {
  if (!state || !inspection) return;
  const date = inspection.backup?.createdAt ? formatBackupDate(inspection.backup.createdAt) : t("app.withAnUnknownDate");
  const messages = {
    missing: t("app.theNewestPinnedEntryIsNotA"),
    current: t("app.thePinnedCopyFromAlreadyMatchesThis", { 0: date }),
    newer: t("app.thePinnedCopyFromIsNewerThan", { 0: date }),
    "not-newer": t("app.theLocalDatabaseIsNotOlderThan", { 0: date }),
    "unknown-date": t("app.theDateOfThePinnedCopyIs")
  };
  state.textContent = messages[inspection.status] || t("app.backupStatusUnknown");
}

function backupRecoveryRequested() {
  try { return new URL(globalThis.location?.href || "").searchParams.get("restore") === "1"; }
  catch { return false; }
}

function clearBackupRecoveryRequest() {
  if (!backupRecoveryRequested()) return;
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("restore");
    globalThis.history?.replaceState?.(globalThis.history.state, "", url.toString());
  } catch { /* an invalid host URL cannot occur in a verified Mini App */ }
}

function formatBackupDate(value) {
  const date = new Date(Number(value || 0));
  return Number.isNaN(date.getTime()) ? t("app.unknown") : date.toLocaleString(getLocale());
}

function bindController(controller, continueFromResult) {
  const run = operation => async values => {
    try { await continueFromResult(await operation(values || {})); }
    catch (error) {
      const retryState = error instanceof AuthBootstrapError && ["TOKEN_NETWORK_ERROR", "TOKEN_INVALID", "PASSWORD_REQUIRED"].includes(error.code)
        ? controller.state
        : error instanceof AuthBootstrapError ? stateForError(error) : controller.state;
      gateView.show(retryState, { message: safeMessage(error) });
    }
  };
  gateView.bind({
    onFirstPassword: run(values => controller.beginFirstSetup(values)),
    onFirstToken: run(values => controller.finishFirstSetup(values)),
    onUnlock: run(values => controller.unlock(values)),
    onShowRecovery: run(() => Promise.resolve(controller.transition("RECOVERY_PASSWORD"))),
    onRecoveryPassword: run(values => controller.beginRecovery(values)),
    onRecoveryToken: run(values => controller.finishRecovery(values)),
    onReplacementToken: run(values => controller.replaceRevokedToken(values)),
    onError: error => gateView.show(controller.state, { message: safeMessage(error) })
  });
}

function unlockApplicationShell() {
  documentRoot.body.dataset.appLocked = "false";
  appShell?.removeAttribute("inert");
  appShell?.setAttribute("aria-hidden", "false");
  gateView.release();
}

function stateForError(error) {
  if (error instanceof TelegramEnvironmentError) return error.code;
  if (error instanceof AuthBootstrapError) return error.code;
  return "DATABASE_ERROR";
}

function safeMessage(error) {
  // Only controller/environment messages are intentionally generic and never
  // include passwords, initData, storage keys, ciphertext or Bot API URLs.
  return error instanceof TelegramEnvironmentError || error instanceof AuthBootstrapError ? error.message : t("bootstrap.theOperationCouldNotBeCompletedPlease");
}

function logBootstrapFailure(stage, error) {
  // Environment and authorization errors can contain third-party causes.
  // The database path is the only one whose full IndexedDB diagnostic is safe.
  if (stage === "database") {
    console.error("[Post Manipulator] Local database startup failed", error);
    return;
  }
  console.error("[Post Manipulator] Security bootstrap failed", {
    stage,
    name: error?.name || "Error",
    message: safeMessage(error)
  });
}
