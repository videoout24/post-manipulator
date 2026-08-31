export class AppNavigation {
  constructor({ root = document, initialTab = "editor", onEditor = null, onProject = null } = {}) {
    this.root = root;
    this.activeTab = initialTab;
    this.onEditor = onEditor;
    this.onProject = onProject;
    this.tabButtons = [...root.querySelectorAll("[data-tab]")];
    this.tabPages = [...root.querySelectorAll("[data-tab-page]")];
    this.settingsBrandButton = root.querySelector("#openSettingsFromBrand");
    this.settingsSectionButtons = [...root.querySelectorAll("[data-settings-section]")];
    this.settingsPanels = [...root.querySelectorAll("[data-settings-panel]")];
    this.unsubscribers = [];
  }

  start() {
    for (const button of this.tabButtons) {
      this.#listen(button, "click", () => this.activateTab(button.dataset.tab));
    }
    this.#listen(this.settingsBrandButton, "click", () => this.activateTab("settings"));
    for (const button of this.settingsSectionButtons) {
      this.#listen(button, "click", () => this.activateSettingsSection(button.dataset.settingsSection));
    }
    return this;
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
  }

  activateTab(name) {
    if (!this.tabPages.some(page => page.dataset.tabPage === name)) return false;
    this.activeTab = name;
    for (const button of this.tabButtons) {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const page of this.tabPages) page.classList.toggle("active", page.dataset.tabPage === name);
    if (this.settingsBrandButton) {
      const active = name === "settings";
      this.settingsBrandButton.classList.toggle("active", active);
      this.settingsBrandButton.setAttribute("aria-pressed", String(active));
    }
    if (name === "editor") this.onEditor?.();
    else if (name === "project") this.onProject?.();
    return true;
  }

  activateSettingsSection(name) {
    if (!this.settingsPanels.some(panel => panel.dataset.settingsPanel === name)) return false;
    for (const button of this.settingsSectionButtons) {
      const active = button.dataset.settingsSection === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const panel of this.settingsPanels) {
      panel.classList.toggle("active", panel.dataset.settingsPanel === name);
    }
    return true;
  }

  #listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    this.unsubscribers.push(() => target.removeEventListener(name, handler));
  }
}
