import assert from "node:assert/strict";
import { AppNavigation } from "../js/app/AppNavigation.js?v=1.5.9";

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.attributes = new Map();
    this.classes = new Set();
    this.listeners = new Map();
    this.classList = {
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); }
  click() { this.listeners.get("click")?.(); }
}

const editorButton = new FakeElement({ tab: "editor" });
const projectButton = new FakeElement({ tab: "project" });
const editorPage = new FakeElement({ tabPage: "editor" });
const projectPage = new FakeElement({ tabPage: "project" });
const settingsPage = new FakeElement({ tabPage: "settings" });
const settingsBrand = new FakeElement();
const generalButton = new FakeElement({ settingsSection: "general" });
const generalPanel = new FakeElement({ settingsPanel: "general" });
const root = {
  querySelectorAll(selector) {
    return {
      "[data-tab]": [editorButton, projectButton],
      "[data-tab-page]": [editorPage, projectPage, settingsPage],
      "[data-settings-section]": [generalButton],
      "[data-settings-panel]": [generalPanel]
    }[selector] || [];
  },
  querySelector(selector) { return selector === "#openSettingsFromBrand" ? settingsBrand : null; }
};

let editorActivations = 0;
let projectActivations = 0;
const navigation = new AppNavigation({
  root,
  onEditor: () => editorActivations++,
  onProject: () => projectActivations++
}).start();

projectButton.click();
assert.equal(navigation.activeTab, "project");
assert(projectPage.classes.has("active"));
assert(!editorPage.classes.has("active"));
assert.equal(projectButton.attributes.get("aria-selected"), "true");
assert.equal(projectActivations, 1);

settingsBrand.click();
assert.equal(navigation.activeTab, "settings");
assert(settingsPage.classes.has("active"));
assert(settingsBrand.classes.has("active"));
assert.equal(settingsBrand.attributes.get("aria-pressed"), "true");

generalButton.click();
assert(generalPanel.classes.has("active"));
assert.equal(generalButton.attributes.get("aria-selected"), "true");

navigation.stop();
assert.equal(projectButton.listeners.size, 0);
assert.equal(editorActivations, 0);

console.log("app_navigation_smoke: OK");
