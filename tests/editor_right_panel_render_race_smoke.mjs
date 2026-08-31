import assert from "node:assert/strict";
import { EditorRightPanel } from "../js/editor/EditorRightPanel.js?v=1.5.9";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = { toggle() {}, add() {} };
    this.hidden = false;
    this.lastElementChild = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node?.isFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
    this.lastElementChild = this.children.at(-1) || null;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute() {}
  querySelector() { return null; }
  closest() { return null; }
  set innerHTML(value) { if (value === "") this.children = []; }
}

globalThis.document = {
  createElement: tag => new FakeElement(tag),
  createDocumentFragment: () => Object.assign(new FakeElement("fragment"), { isFragment: true })
};

const pending = [];
const drafts = {
  list: () => new Promise(resolve => pending.push(resolve))
};
const root = new FakeElement("aside");
const layout = new FakeElement("main");
const panel = new EditorRightPanel({
  root,
  layout,
  session: { isProjectActive: () => false },
  draftSession: { activeDraftId: null, isActive: () => false },
  drafts
});
assert.equal(panel.mode, "drafts", "the right Drafts panel is the default outside a Project");
panel.mode = "drafts";

const olderRender = panel.render();
const newerRender = panel.render();
assert.equal(pending.length, 2, "two concurrent Draft list reads must be in flight");

const row = { id: "draft_one", title: "One", updatedAt: 1, source: { kind: "draft" } };
pending[1]([row]);
await newerRender;
pending[0]([row]);
await olderRender;

assert.equal(root.children.length, 2, "only one header and one Draft list may be committed");
assert.equal(root.children[1].children.length, 1, "one stored Draft must produce one card");
assert.equal(root.children[1].children[0].dataset.draftId, row.id);

const projectEvents = new EventBus();
const projectRoot = new FakeElement("aside");
const projectLayout = new FakeElement("main");
const project = { id: "project_a", title: "Project", posts: [{ id: "post_1", title: "First", messageAst: { id: "root", children: [] }, deployments: {} }] };
const projectSession = {
  activeProjectId: project.id,
  activePostId: "post_1",
  project,
  isProjectActive: () => true,
  snapshot() { return { activeProjectId: this.activeProjectId, activePostId: this.activePostId, project: structuredClone(this.project) }; },
  async openPost(postId) {
    this.activePostId = postId;
    return this.snapshot();
  }
};
const projectPanel = new EditorRightPanel({ root: projectRoot, layout: projectLayout, session: projectSession, events: projectEvents });
projectPanel.start();
const postList = projectRoot.children[1];
assert.equal(postList.children.length, 1, "the Project list contains the canonical post cards");
postList.children[0].onclick({ target: { closest: () => null } });
await new Promise(resolve => queueMicrotask(resolve));
assert.equal(projectSession.activePostId, "post_1", "navigation handlers must remain active after the post list rerenders");
projectPanel.stop();

console.log("editor_right_panel_render_race_smoke: OK");
