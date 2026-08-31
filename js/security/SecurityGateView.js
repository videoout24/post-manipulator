const STATE_COPY = Object.freeze({
  CHECKING_ENVIRONMENT: ["Проверяем защищённый запуск", "Пожалуйста, подождите…"],
  OPENING_DATABASE: ["Открываем локальную базу", "Данные остаются на этом устройстве."],
  BLOCKED_NOT_TELEGRAM: ["Откройте из Telegram", "Post Manipulator запускается только как Telegram Mini App."],
  BLOCKED_NOT_DESKTOP: [ "Неподдерживаемое окружение.", "Поддерживается только Telegram Desktop-клиент."],
  BLOCKED_INIT_DATA_MISSING: ["Нет безопасных данных запуска", "Закройте Mini App и откройте её заново из Telegram."],
  BLOCKED_INIT_DATA_INVALID: ["Не удалось подтвердить запуск", "Закройте Mini App и откройте её заново из Telegram."],
  BLOCKED_INIT_DATA_EXPIRED: ["Запуск устарел", "Закройте Mini App и откройте её заново из Telegram."],
  BLOCKED_TELEGRAM_USER_INVALID: ["Пользователь Telegram не подтверждён", "Закройте Mini App и откройте её заново из Telegram."],
  BLOCKED_TELEGRAM_USER_MISMATCH: ["Эта локальная база привязана к другому аккаунту Telegram", "Пароль и token не будут запрошены. Данные не изменены."],
  BLOCKED_CRYPTO_UNSUPPORTED: ["Криптография клиента не поддерживается", "Обновите Telegram Desktop и повторите попытку."],
  BLOCKED_CLOUD_STORAGE_UNSUPPORTED: ["CloudStorage не поддерживается", "Telegram Desktop сообщил, что облачное хранилище недоступно. Обновите клиент."],
  BLOCKED_CLOUD_STORAGE_TIMEOUT: ["CloudStorage не ответил", "Telegram Desktop не ответил на запрос к облачному хранилищу. Закройте Mini App и откройте её снова."],
  BLOCKED_CLOUD_STORAGE_ERROR: ["Ошибка CloudStorage", "Telegram Desktop вернул ошибку при проверке облачного хранилища. Данные не изменены."],
  DATABASE_ERROR: ["Не удалось открыть локальную базу", "Рабочая область не была запущена."],
  STARTING_APPLICATION: ["Запускаем Post Manipulator", "Защищённый token остаётся только в памяти этого запуска."],
  TOKEN_ENCRYPTING: ["Сохраняем защищённый token", "Проверяем запись Telegram CloudStorage…"],
  TOKEN_ROTATING: ["Обновляем защищённый token", "Создаём новую соль и IV для этого входа…"]
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
    const close = element("button", "", "Закрыть Mini App");
    close.type = "button";
    close.addEventListener("click", () => this.webApp?.close?.());
    actions.append(close);
    return actions;
  }
}

function contentForState(view, state, payload) {
  const [defaultTitle, defaultCopy] = STATE_COPY[state] || ["Защищённый запуск", "Пожалуйста, подождите…"];
  const result = { title: defaultTitle, copy: payload.message || defaultCopy, detail: "", form: null, actions: null };
  if (state === "FIRST_SETUP_PASSWORD") {
    result.title = "Создайте пароль";
    result.copy = payload.existingData
      ? "Локальные данные сохранены. Пароль зашифрует token перед сохранением в Telegram CloudStorage."
      : "Пароль зашифрует token перед сохранением в Telegram CloudStorage.";
    result.form = view.form({
      fields: [
        { name: "password", label: "Пароль", autocomplete: "new-password" },
        { name: "confirmation", label: "Повторите пароль", autocomplete: "new-password" }
      ], submitLabel: "Продолжить", action: "onFirstPassword"
    });
  } else if (state === "FIRST_SETUP_TOKEN") {
    result.title = "Подключите Publisher Bot";
    result.copy = "Token будет проверен через getMe, зашифрован и сохранён только в Telegram CloudStorage.";
    result.form = view.form({ fields: [{ name: "token", label: "Bot API token", autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: "Проверить и сохранить", action: "onFirstToken" });
  } else if (state === "UNLOCK_PASSWORD") {
    result.title = "Разблокируйте Publisher";
    result.copy = "Введите пароль. После проверки защищённая запись будет повторно зашифрована с новой солью и IV.";
    result.form = view.form({
      fields: [{ name: "password", label: "Пароль", autocomplete: "current-password" }],
      submitLabel: "Разблокировать", action: "onUnlock", secondary: { label: "Не помню пароль", action: "onShowRecovery" }
    });
  } else if (state === "RECOVERY_PASSWORD") {
    result.title = payload.reason === "record_not_found"
      ? "Запись CloudStorage не найдена"
      : payload.reason === "decrypt_failed"
        ? "Запись CloudStorage не расшифрована"
        : "Восстановление credentials";
    result.copy = "Создайте и подтвердите пароль. Затем введите актуальный token этого же бота: он будет зашифрован и сохранён в CloudStorage.";
    result.form = view.form({ fields: [
      { name: "password", label: "Новый пароль", autocomplete: "new-password" },
      { name: "confirmation", label: "Повторите новый пароль", autocomplete: "new-password" }
    ], submitLabel: "Продолжить", action: "onRecoveryPassword" });
  } else if (state === "RECOVERY_TOKEN") {
    result.title = "Введите актуальный token";
    result.copy = "Token обязан принадлежать уже привязанному Publisher Bot.";
    result.form = view.form({ fields: [{ name: "token", label: "Bot API token", autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: "Проверить и сохранить", action: "onRecoveryToken" });
  } else if (state === "TOKEN_REVOKED") {
    result.title = "Token отозван или недействителен";
    result.copy = "Локальная база и прежняя защищённая запись сохранены. Введите новый token того же бота.";
    result.form = view.form({ fields: [{ name: "token", label: "Новый Bot API token", autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: "Заменить token", action: "onReplacementToken" });
  } else if (state === "TOKEN_INVALID") {
    result.title = "Telegram не принял token";
    result.copy = "Проверьте token и повторите попытку.";
    const action = payload.flow === "recovery" ? "onRecoveryToken" : payload.flow === "token_replacement" ? "onReplacementToken" : "onFirstToken";
    result.form = view.form({ fields: [{ name: "token", label: "Bot API token", autocomplete: "off", placeholder: "123456:ABC…" }], submitLabel: "Повторить", action });
  } else if (state === "TOKEN_BOT_MISMATCH") {
    result.title = "Token принадлежит другому боту";
    result.copy = "Эта локальная база уже привязана к другому Publisher Bot. Данные не изменены.";
    result.actions = view.closeActions();
  } else if (state === "CLOUD_STORAGE_READING" || state === "CLOUD_STORAGE_WRITE_ERROR" || state === "TOKEN_NETWORK_ERROR") {
    result.title = "Операцию не удалось завершить";
    result.copy = payload.message || "Проверьте сеть и Telegram Desktop, затем повторите попытку.";
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
