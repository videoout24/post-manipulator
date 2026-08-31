export class SelectionModel {
  constructor(events) {
    this.events = events;
    this.ids = new Set();
  }

  clear() {
    this.ids.clear();
    this.emit();
  }

  set(id) {
    this.ids = id ? new Set([id]) : new Set();
    this.emit();
  }

  toggle(id) {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.emit();
  }

  has(id) { return this.ids.has(id); }
  all() { return [...this.ids]; }
  primary() { return this.all()[0] || null; }
  size() { return this.ids.size; }

  emit() {
    this.events.emit("selection:changed", this.all());
  }
}
