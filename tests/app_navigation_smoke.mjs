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
const fontsButton = new FakeElement({ settingsSection: "fonts" });
const generalPanel = new FakeElement({ settingsPanel: "general" });
const fontsPanel = new FakeElement({ settingsPanel: "fonts" });
const root = {
  querySelectorAll(selector) {
    return {
      "[data-tab]": [editorButton, projectButton],
      "[data-tab-page]": [editorPage, projectPage, settingsPage],
      "[data-settings-section]": [generalButton, fontsButton],
      "[data-settings-panel]": [generalPanel, fontsPanel]
    }[selector] || [];
  },
  querySelector(selector) { return selector === "#openSettingsFromBrand" ? settingsBrand : null; }
};

let editorActivations = 0;
let projectActivations = 0;
let editorTransition = null;
const navigation = new AppNavigation({
  root,
  onEditor: transition => { editorActivations++; editorTransition = transition; },
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

editorButton.click();
assert.equal(editorActivations, 1);
assert.deepEqual(editorTransition, { previousTab: "settings", tab: "editor" });

generalButton.click();
assert(generalPanel.classes.has("active"));
assert.equal(generalButton.attributes.get("aria-selected"), "true");
fontsButton.click();
assert(fontsPanel.classes.has("active"));
assert(!generalPanel.classes.has("active"));
assert.equal(fontsButton.attributes.get("aria-selected"), "true");
assert.equal(generalButton.attributes.get("aria-selected"), "false");

navigation.stop();
assert.equal(projectButton.listeners.size, 0);
assert.equal(editorActivations, 1);

console.log("app_navigation_smoke: OK");
