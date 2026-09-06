const BASE_URL_KEY = "sseBaseUrl";

export class SseProbe {
  constructor({ db, events = null, fetchFn = globalThis.fetch?.bind(globalThis), eventSourceFactory = defaultEventSourceFactory } = {}) {
    this.db = db;
    this.events = events;
    this.fetchFn = fetchFn;
    this.eventSourceFactory = eventSourceFactory;
    this.source = null;
    this.state = {
      baseUrl: "",
      connection: "idle",
      lastEvent: "",
      lastPush: null,
      error: ""
    };
  }

  async initialize() {
    this.state.baseUrl = String(await this.db.get("settings", BASE_URL_KEY, "") || "");
    this.#emit();
    return this.getState();
  }

  getState() { return { ...this.state }; }

  async setBaseUrl(value) {
    const baseUrl = normalizeBaseUrl(value);
    await this.db.put("settings", BASE_URL_KEY, baseUrl);
    this.state = { ...this.state, baseUrl, error: "" };
    this.#emit();
    return baseUrl;
  }

  async connect(value = this.state.baseUrl) {
    const baseUrl = await this.setBaseUrl(value);
    this.disconnect({ silent: true });
    this.state = { ...this.state, connection: "connecting", error: "" };
    this.#emit();

    try {
      const source = this.eventSourceFactory(`${baseUrl}/events`);
      this.source = source;
      source.onopen = () => {
        if (this.source !== source) return;
        this.state = { ...this.state, connection: "open", error: "" };
        this.#emit();
      };
      source.onmessage = event => {
        if (this.source !== source) return;
        this.state = { ...this.state, lastEvent: String(event?.data ?? ""), lastPush: null, error: "" };
        this.#emit();
      };
      source.onerror = () => {
        if (this.source !== source) return;
        this.state = { ...this.state, connection: "error", error: "SSE connection error" };
        this.#emit();
      };
      return this.getState();
    } catch (error) {
      this.state = { ...this.state, connection: "error", error: error?.message || String(error) };
      this.#emit();
      throw error;
    }
  }

  disconnect({ silent = false } = {}) {
    const source = this.source;
    this.source = null;
    source?.close?.();
    this.state = { ...this.state, connection: "closed", error: "" };
    if (!silent) this.#emit();
    return this.getState();
  }

  async pushTest(value = this.state.baseUrl) {
    const baseUrl = await this.setBaseUrl(value);
    if (typeof this.fetchFn !== "function") throw new Error("Fetch API is unavailable");
    try {
      const response = await this.fetchFn(`${baseUrl}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "GitHub Pages → Tailscale → SSE" })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(`HTTP ${response.status}${payload ? `: ${formatPayload(payload)}` : ""}`);
      this.state = { ...this.state, lastEvent: "", lastPush: payload, error: "" };
      this.#emit();
      return payload;
    } catch (error) {
      this.state = { ...this.state, error: error?.message || String(error) };
      this.#emit();
      throw error;
    }
  }

  stop() { this.disconnect({ silent: true }); }

  #emit() { this.events?.emit?.("network:sse-probe", this.getState()); }
}

export function normalizeBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) throw new Error("Base URL is required");
  let url;
  try { url = new URL(text); }
  catch { throw new Error("Base URL must be a valid absolute URL"); }
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("Base URL must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("Base URL must not contain credentials, query, or fragment");
  return url.toString().replace(/\/$/, "");
}

function defaultEventSourceFactory(url) {
  if (typeof globalThis.EventSource !== "function") throw new Error("EventSource API is unavailable");
  return new globalThis.EventSource(url);
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

function formatPayload(payload) {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export { BASE_URL_KEY };
