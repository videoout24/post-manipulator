import { t } from "../i18n/index.js?v=1.8.0";
const STATE_COPY = Object.freeze({
  CHECKING_ENVIRONMENT: [t("security.securityGateView.checkingSecureLaunch"), t("security.securityGateView.pleaseWait")],
  OPENING_DATABASE: [t("security.securityGateView.openingLocalDatabase"), t("security.securityGateView.dataRemainsOnThisDevice")],
  BLOCKED_NOT_TELEGRAM: [t("security.securityGateView.openFromTelegram"), t("security.securityGateView.postManipulatorRunsOnlyAsATelegram")],
  BLOCKED_NOT_DESKTOP: [ t("security.securityGateView.unsupportedEnvironment"), t("security.securityGateView.onlyTelegramDesktopClientIsSupported")],
  BLOCKED_INIT_DATA_MISSING: [t("security.securityGateView.noSecureLaunchData"), t("security.securityGateView.closeTheMiniAppAndOpenIt")],
  BLOCKED_INIT_DATA_INVALID: [t("security.securityGateView.failedToConfirmLaunch"), t("security.securityGateView.closeTheMiniAppAndOpenIt")],
  BLOCKED_INIT_DATA_EXPIRED: [t("security.securityGateView.launchIsOutdated"), t("security.securityGateView.closeTheMiniAppAndOpenIt")],
  BLOCKED_INIT_DATA_TIME_INVALID: [t("security.securityGateView.checkDeviceTime"), t("security.securityGateView.telegramLaunchTimeDoesNotMatchSystem")],
  BLOCKED_TELEGRAM_USER_INVALID: [t("security.securityGateView.telegramUserNotVerified"), t("security.securityGateView.closeTheMiniAppAndOpenIt")],
  BLOCKED_TELEGRAM_USER_MISMATCH: [t("security.authBootstrapController.thisLocalDatabaseIsLinkedToAnother"), t("security.securityGateView.passwordAndTokenWillNotBeRequested")],
  BLOCKED_CRYPTO_UNSUPPORTED: [t("security.securityGateView.clientCryptographyNotSupported"), t("security.securityGateView.updateTelegramDesktopAndTryAgain")],
  BLOCKED_CLOUD_STORAGE_UNSUPPORTED: [t("security.securityGateView.cloudstorageNotSupported"), t("security.securityGateView.telegramDesktopReportedThatCloudStorageIs")],
  BLOCKED_CLOUD_STORAGE_TIMEOUT: [t("security.securityGateView.cloudstorageDidNotRespond"), t("security.securityGateView.telegramDesktopDidNotRespondToThe")],
  BLOCKED_CLOUD_STORAGE_ERROR: [t("security.securityGateView.cloudstorageError"), t("security.securityGateView.telegramDesktopReturnedAnErrorWhileChecking")],
  DATABASE_ERROR: [t("security.securityGateView.failedToOpenLocalDatabase"), t("security.securityGateView.workspaceWasNotLaunched")],
  STARTING_APPLICATION: [t("security.securityGateView.launchingPostManipulator"), t("security.securityGateView.protectedTokenRemainsOnlyInMemoryFor")],
  TOKEN_ENCRYPTING: [t("security.securityGateView.savingProtectedToken"), t("security.securityGateView.checkingTelegramCloudStorageEntry")],
  TOKEN_ROTATING: [t("security.securityGateView.updatingProtectedToken"), t("security.securityGateView.creatingNewSaltAndIVForThis")]
});

const DEVICE_TIME_HINT_STATES = new Set([
  "BLOCKED_INIT_DATA_EXPIRED",
  "BLOCKED_INIT_DATA_TIME_INVALID"
]);
const DEVICE_TIME_HINT = t("security.securityGateView.checkAutomaticSynchronizationOfDateTimeAnd");
const LAUNCH_WINDOW_HINT_STATES = new Set([
  "CHECKING_ENVIRONMENT",
  "FIRST_SETUP_PASSWORD",
  "UNLOCK_PASSWORD"
]);
const LAUNCH_WINDOW_HINT = t("security.securityGateView.launchDataIsCheckedWithinA30");

const BUSY_STATES = new Set([
  "CHECKING_ENVIRONMENT",
  "OPENING_DATABASE",
  "PROCESSING_PASSWORD",
  "PROCESSING_TOKEN",
  "STARTING_APPLICATION",
  "TOKEN_ENCRYPTING",
  "TOKEN_ROTATING"
]);

const ACTION_PROGRESS = Object.freeze({
  onFirstPassword: ["PROCESSING_PASSWORD", t("security.securityGateView.checkingAndAcceptingPassword")],
  onUnlock: ["PROCESSING_PASSWORD", t("security.securityGateView.decryptingTokenAndCheckingProtectedLaunch")],
  onRecoveryPassword: ["PROCESSING_PASSWORD", t("security.securityGateView.preparingNewProtectedCredentials")],
  onFirstToken: ["PROCESSING_TOKEN", t("security.securityGateView.telegramChecksThePublisherBotThenThe")],
  onRecoveryToken: ["PROCESSING_TOKEN", t("security.securityGateView.telegramChecksThePublisherBotThenThe2")],
  onReplacementToken: ["PROCESSING_TOKEN", t("security.securityGateView.telegramChecksTheNewTokenAndBot")]
});

/** Presentational UI only; transitions live in AuthBootstrapController. */
export class SecurityGateView {
  constructor({ root, webApp = null } = {}) {
    this.root = root;
    this.webApp = webApp;
    this.canCloseMiniApp = false;
    this.handlers = {};
    this.currentState = "BOOT_LOCKED";
  }

  bind(handlers) { this.handlers = { ...handlers }; }
  setWebApp(webApp, { canCloseMiniApp = false } = {}) {
    this.webApp = webApp;
    this.canCloseMiniApp = Boolean(canCloseMiniApp);
  }

  show(state, payload = {}) {
    this.currentState = state;
    if (!this.root) return;
    this.root.hidden = false;
    this.root.dataset.state = state;
    this.root.replaceChildren();
    const card = element("div", "security-gate-card");
    const content = contentForState(this, state, payload);
    card.append(element("h1", "security-gate-title", content.title), element("p", "security-gate-copy", content.copy));
    if (content.detail) card.append(element("p", "security-gate-detail", content.detail));
    if (BUSY_STATES.has(state)) {
      card.setAttribute("aria-busy", "true");
      const progress = element("div", "security-gate-progress", t("security.securityGateView.operationIsInProgress"));
      progress.setAttribute("role", "status");
      progress.setAttribute("aria-live", "polite");
      progress.prepend(element("span", "security-gate-spinner"));
      card.append(progress);
    }
    if (content.form) card.append(content.form);
    if (content.actions) card.append(content.actions);
    this.root.append(card);
  }

  release() {
    if (!this.root) return;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  #submit(action, values) {
    const progress = ACTION_PROGRESS[action];
    if (progress) this.show(progress[0], { message: progress[1] });
    Promise.resolve(this.handlers[action]?.(values)).catch(error => this.handlers.onError?.(error));
  }

  form({ fields, submitLabel, action, secondary = null }) {
    const form = element("form", "security-gate-form");
    form.noValidate = true;
    for (const field of fields) {
      const label = element("label", "security-gate-field");
      label.append(element("span", "", field.label));
      const input = document.createElement("input");
      input.name = field.name;
      input.type = field.type || "password";
      input.autocomplete = field.autocomplete || "off";
      input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      label.append(input);
      form.append(label);
    }
    const actions = element("div", "security-gate-actions");
    const submit = element("button", "primary", submitLabel);
    submit.type = "submit";
    actions.append(submit);
    if (secondary) {
      const secondaryButton = element("button", "", secondary.label);
      secondaryButton.type = "button";
      secondaryButton.addEventListener("click", () => {
        const values = Object.fromEntries(new FormData(form));
        for (const input of form.querySelectorAll("input[type=password]")) input.value = "";
        this.#submit(secondary.action, values);
      });
      actions.append(secondaryButton);
    }
    form.append(actions);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      for (const input of form.querySelectorAll("input[type=password]")) input.value = "";
      this.#submit(action, values);
    });
    return form;
  }

  closeActions() {
    // Browser pages are generally not allowed to close a user-opened tab.
    // Do not present a non-functional “close” control outside Telegram.
    if (!this.canCloseMiniApp || typeof this.webApp?.close !== "function") return null;
    const actions = element("div", "security-gate-actions");
    const close = element("button", "", t("security.securityGateView.closeMiniApp"));
    close.type = "button";
    close.addEventListener("click", () => this.webApp?.close?.());
    actions.append(close);
    return actions;
  }
}

function contentForState(view, state, payload) {
  const [defaultTitle, defaultCopy] = STATE_COPY[state] || [t("security.securityGateView.secureLaunch"), t("security.securityGateView.pleaseWait")];
  const result = { title: defaultTitle, copy: payload.message || defaultCopy, detail: "", form: null, actions: null };
  if (DEVICE_TIME_HINT_STATES.has(state)) result.detail = DEVICE_TIME_HINT;
  else if (LAUNCH_WINDOW_HINT_STATES.has(state)) result.detail = LAUNCH_WINDOW_HINT;
  if (state === "PROCESSING_PASSWORD") {
    result.title = t("security.securityGateView.checkingCredentials");
  } else if (state === "PROCESSING_TOKEN") {
    result.title = t("security.securityGateView.connectingPublisherBot");
  } else if (state === "FIRST_SETUP_PASSWORD") {
    result.title = t("security.securityGateView.createAPassword");
    result.copy = payload.existingData
      ? t("security.securityGateView.localDataSavedThePasswordWillEncrypt")
      : t("security.securityGateView.thePasswordWillEncryptTheTokenBefore");
    result.form = view.form({
      fields: [
        { name: "password", label: t("security.securityGateView.password"), autocomplete: "new-password" },
        { name: "confirmation", label: t("security.securityGateView.repeatPassword"), autocomplete: "new-password" }
      ], submitLabel: t("app.continue"), action: "onFirstPassword"
    });
  } else if (state === "FIRST_SETUP_TOKEN") {
    result.title = t("security.securityGateView.connectPublisherBot");
    result.copy = t("security.securityGateView.theTokenWillBeVerifiedViaGetMe");
    result.form = view.form({ fields: [{ name: "token", label: t("security.securityGateView.botApiToken"), autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: t("security.securityGateView.verifyAndSave"), action: "onFirstToken" });
  } else if (state === "UNLOCK_PASSWORD") {
    result.title = t("security.securityGateView.unlockPublisher");
    result.copy = t("security.securityGateView.enterThePasswordAfterVerificationTheProtected");
    result.form = view.form({
      fields: [{ name: "password", label: t("security.securityGateView.password"), autocomplete: "current-password" }],
      submitLabel: t("security.securityGateView.unlock"), action: "onUnlock", secondary: { label: t("security.securityGateView.iDonTRememberThePassword"), action: "onShowRecovery" }
    });
  } else if (state === "RECOVERY_PASSWORD") {
    result.title = payload.reason === "record_not_found"
      ? t("security.securityGateView.cloudstorageRecordNotFound")
      : payload.reason === "decrypt_failed"
        ? t("security.securityGateView.cloudstorageRecordNotDecrypted")
        : t("security.securityGateView.restoringCredentials");
    result.copy = t("security.securityGateView.createAndConfirmThePasswordThenEnter");
    result.form = view.form({ fields: [
      { name: "password", label: t("security.securityGateView.newPassword"), autocomplete: "new-password" },
      { name: "confirmation", label: t("security.securityGateView.repeatNewPassword"), autocomplete: "new-password" }
    ], submitLabel: t("app.continue"), action: "onRecoveryPassword" });
  } else if (state === "RECOVERY_TOKEN") {
    result.title = t("security.securityGateView.enterTheCurrentToken");
    result.copy = t("security.securityGateView.theTokenMustBelongToAnAlready");
    result.form = view.form({ fields: [{ name: "token", label: t("security.securityGateView.botApiToken"), autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: t("security.securityGateView.verifyAndSave"), action: "onRecoveryToken" });
  } else if (state === "TOKEN_REVOKED") {
    result.title = t("security.authBootstrapController.tokenRevokedOrInvalid");
    result.copy = t("security.securityGateView.theLocalDatabaseAndThePreviousProtected");
    result.form = view.form({ fields: [{ name: "token", label: t("security.securityGateView.newBotAPIToken"), autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: t("security.securityGateView.replaceToken"), action: "onReplacementToken" });
  } else if (state === "TOKEN_INVALID") {
    result.title = t("security.securityGateView.telegramDidNotAcceptTheToken");
    result.copy = t("security.securityGateView.checkTheTokenAndTryAgain");
    const action = payload.flow === "recovery" ? "onRecoveryToken" : payload.flow === "token_replacement" ? "onReplacementToken" : "onFirstToken";
    result.form = view.form({ fields: [{ name: "token", label: t("security.securityGateView.botApiToken"), autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: t("security.securityGateView.retry"), action });
  } else if (state === "TOKEN_BOT_MISMATCH") {
    result.title = t("security.securityGateView.theTokenBelongsToAnotherBot");
    result.copy = t("security.securityGateView.thisLocalDatabaseIsAlreadyLinkedTo");
    result.actions = view.closeActions();
  } else if (state === "CLOUD_STORAGE_READING" || state === "CLOUD_STORAGE_WRITE_ERROR" || state === "TOKEN_NETWORK_ERROR") {
    result.title = t("security.securityGateView.theOperationCouldNotBeCompleted");
    result.copy = payload.message || t("security.securityGateView.checkYourNetworkAndTelegramDesktopThen");
    result.actions = view.closeActions();
  } else if (state.startsWith("BLOCKED_")) {
    result.actions = view.closeActions();
  }
  if (payload.message && payload.message !== result.copy) result.detail = payload.message;
  return result;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
