export class NetPanel {
  constructor({ root, onPollingChange = null, onOfflineClick = null } = {}) {
    if (!root) throw new Error("NetPanel requires a root element");
    this.root = root;
    this.onPollingChange = onPollingChange;
    this.onOfflineClick = onOfflineClick;
    this.timers = { request: null, polling: null };
    this.state = {
      available: true,
      expanded: false,
      requestActive: false,
      pollingEnabled: false,
      requestPulseOn: false,
      pollingPulseOn: false
    };
    this.#build();
    this.#render();
  }

  #build() {
    const itemId = "app-net-panel-items";
    this.root.className = "net-panel";
    this.root.innerHTML = `
      <button class="net-panel__button" type="button" aria-controls="${itemId}">
        <svg class="net-panel__network" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.9 5c-.17 0-.32.09-.41.23l-.07.15-5.18 11.23c-.16.29-.26.61-.26.96 0 1.07.87 1.93 1.93 1.93.79 0 1.47-.48 1.76-1.16l.01-.01 3.49-12.08c.01-.05.03-.1.03-.15 0-.61-.58-1.1-1.3-1.1zM1 9l2 2c2.88-2.88 6.79-4.08 10.53-3.62l1.19-2.59C9.89 3.89 4.71 5.29 1 9zm20 2 2-2c-1.64-1.64-3.54-2.83-5.56-3.57l-.81 2.76C18.22 8.83 19.71 9.76 21 11zm-4 4 2-2c-.87-.87-1.89-1.5-2.97-1.89l-.81 2.74c.65.27 1.25.65 1.78 1.15zM5 13l2 2c1.13-1.13 2.61-1.63 4.09-1.51l1.28-2.78C9.73 10.24 6.91 11 5 13z"/>
        </svg>
      </button>
      <span class="net-panel__items" id="${itemId}">
        <span class="net-panel__triangle-button" title="Активность Telegram API" aria-hidden="true">
          <svg class="net-panel__triangle net-panel__triangle--request" viewBox="0 0 24 24"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </span>
        <button class="net-panel__triangle-button net-panel__polling-button" type="button">
          <svg class="net-panel__triangle net-panel__triangle--polling" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </span>`;
    this.networkButton = this.root.querySelector(".net-panel__button");
    this.requestTriangle = this.root.querySelector(".net-panel__triangle--request");
    this.pollingButton = this.root.querySelector(".net-panel__polling-button");
    this.pollingTriangle = this.root.querySelector(".net-panel__triangle--polling");
    this.networkButton.addEventListener("click", () => this.toggleExpanded());
    this.pollingButton.addEventListener("click", () => {
      const enabled = !this.state.pollingEnabled;
      this.setPollingEnabled(enabled);
      this.onPollingChange?.(enabled, this);
    });
  }

  setAvailable(available) {
    const wasAvailable = this.state.available;
    this.state.available = Boolean(available);
    if (!this.state.available) {
      this.state.expanded = false;
      this.#stopPulse("request");
      this.#stopPulse("polling");
    } else if (!wasAvailable) {
      if (this.state.requestActive) this.#startPulse("request");
      if (this.state.pollingEnabled) this.#startPulse("polling");
    }
    this.#render();
  }

  setRequestActive(active) {
    active = Boolean(active);
    if (active === this.state.requestActive) return;
    this.state.requestActive = active;
    active ? this.#startPulse("request") : this.#stopPulse("request");
    this.#renderTriangles();
  }

  setPollingEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === this.state.pollingEnabled) return;
    this.state.pollingEnabled = enabled;
    enabled ? this.#startPulse("polling") : this.#stopPulse("polling");
    this.#render();
  }

  isPollingEnabled() {
    return this.state.pollingEnabled;
  }

  setExpanded(expanded) {
    this.state.expanded = Boolean(expanded) && this.state.available;
    this.#render();
  }

  toggleExpanded() {
    if (!this.state.available) {
      this.onOfflineClick?.(this);
      return;
    }
    this.state.expanded = !this.state.expanded;
    this.#render();
  }

  destroy() {
    this.#stopPulse("request");
    this.#stopPulse("polling");
    this.root.innerHTML = "";
  }

  #startPulse(name) {
    this.#stopPulse(name);
    const pulseKey = `${name}PulseOn`;
    this.state[pulseKey] = true;
    const next = () => {
      const active = name === "request" ? this.state.requestActive : this.state.pollingEnabled;
      if (!active) return;
      this.state[pulseKey] = !this.state[pulseKey];
      this.#renderTriangles();
      this.timers[name] = setTimeout(next, this.state[pulseKey] ? 130 : 500);
    };
    this.#renderTriangles();
    this.timers[name] = setTimeout(next, 130);
  }

  #stopPulse(name) {
    if (this.timers[name] !== null) clearTimeout(this.timers[name]);
    this.timers[name] = null;
    this.state[`${name}PulseOn`] = false;
  }

  #renderTriangles() {
    const available = this.state.available;
    this.requestTriangle.classList.toggle("net-panel__triangle--on", available && this.state.requestActive && this.state.requestPulseOn);
    this.pollingTriangle.classList.toggle("net-panel__triangle--on", available && this.state.pollingEnabled && this.state.pollingPulseOn);
    this.pollingTriangle.classList.toggle("net-panel__triangle--stopped", !available);
    this.pollingTriangle.classList.toggle("net-panel__triangle--paused", available && !this.state.pollingEnabled);
  }

  #render() {
    this.root.classList.toggle("net-panel--offline", !this.state.available);
    this.root.classList.toggle("net-panel--polling-paused", this.state.available && !this.state.pollingEnabled);
    this.root.classList.toggle("net-panel--expanded", this.state.available && this.state.expanded);
    this.networkButton.setAttribute("aria-expanded", String(this.state.available && this.state.expanded));
    this.networkButton.title = this.state.available
      ? (this.state.expanded ? "Свернуть индикаторы соединения" : "Развернуть индикаторы соединения")
      : "Нет подключения к сети";
    this.pollingButton.title = this.state.pollingEnabled ? "Остановить фоновый опрос" : "Запустить фоновый опрос";
    this.#renderTriangles();
  }
}
