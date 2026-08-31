export class EventBus {
  constructor() { this.events = new Map(); }

  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
    return () => this.events.get(name)?.delete(fn);
  }

  emit(name, payload) {
    for (const fn of this.events.get(name) || []) fn(payload);
  }

  async emitAsync(name, payload) {
    for (const fn of this.events.get(name) || []) await fn(payload);
  }
}
