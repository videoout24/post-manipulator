import { AppDatabase } from "./storage/AppDatabase.js?v=1.7.1";
import { BotIdentityService } from "./telegram/BotIdentityService.js?v=1.5.9";
import { AuthBootstrapController, AuthBootstrapError } from "./security/AuthBootstrapController.js?v=1.7.0";
import { SECURITY_GATE_CONFIG } from "./security/SecurityGateConfig.js?v=1.6.1";
import { SecurityGateView } from "./security/SecurityGateView.js?v=1.7.0";
import { TelegramEnvironmentGate, TelegramEnvironmentError } from "./security/TelegramEnvironmentGate.js?v=1.7.0";

const documentRoot = globalThis.document;
const appShell = documentRoot?.querySelector?.("#appShell");
const gateView = new SecurityGateView({ root: documentRoot?.querySelector?.("#securityGate") });

// The main module is intentionally absent from the static import graph. It is
// dynamically imported only after a verified Telegram session unlocks a token.
void bootstrapSecurityGate();

async function bootstrapSecurityGate() {
  let appDb = null;
  let controller = null;
  let application = null;
  let bootstrapStage = "environment";
  gateView.show("CHECKING_ENVIRONMENT");
  const earlyWebApp = globalThis.window?.Telegram?.WebApp;
  gateView.setWebApp(earlyWebApp);
  try { earlyWebApp?.ready?.(); } catch { /* a broken bridge stays fail-closed below */ }

  try {
    const environment = await new TelegramEnvironmentGate({ config: SECURITY_GATE_CONFIG }).check();
    gateView.setWebApp(environment.webApp, { canCloseMiniApp: true });
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
        throw new AuthBootstrapError("DATABASE_ERROR", "IndexedDB выбранного бота не была открыта");
      }
      console.info("[Post Manipulator] Bot database ready", {
        engine: appDb.info.engine,
        databaseName: appDb.info.databaseName,
        botId: appDb.botId,
        persistent: appDb.info.persistent === true
      });
      const { startApplication } = await import("./app.js?v=1.7.1");
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
      gateView.show("DATABASE_ERROR", { message: "Основное приложение не было запущено. Данные не изменены." });
      controller.clearSensitiveState();
      await appDb?.close?.().catch(() => {});
      // Keep the detailed error off screen: it can include third-party payloads.
      console.error("Application startup failed after security gate", error);
    }
  }
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
  return error instanceof TelegramEnvironmentError || error instanceof AuthBootstrapError ? error.message : "Операцию не удалось завершить. Повторите попытку.";
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
