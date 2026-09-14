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
      else {
        this.children.push(node);
        if (node) node.parentElement = this;
      }
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
  focus() {}
  select() {}
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  set innerHTML(value) { if (value === "") this.children = []; }
  get childElementCount() { return this.children.length; }
}

globalThis.document = {
  createElement: tag => new FakeElement(tag),
  createDocumentFragment: () => Object.assign(new FakeElement("fragment"), { isFragment: true })
};

const pending = [];
const renamed = [];
const drafts = {
  list: () => new Promise(resolve => pending.push(resolve)),
  async rename(id, title) { renamed.push([id, title]); return { id, title }; }
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

const draftCard = root.children[1].children[0];
const renameButton = draftCard.children[0].children[1].children[1];
renameButton.onclick({ stopPropagation() {} });
const renameOverlay = draftCard.children.at(-1);
const renameInput = renameOverlay.children[0];
const renameSave = renameOverlay.children[1].children[1];
renameInput.value = "Renamed Draft";
renameSave.onclick({ stopPropagation() {} });
await new Promise(resolve => queueMicrotask(resolve));
assert.deepEqual(renamed, [[row.id, "Renamed Draft"]], "the inline editor must pass the new title to DraftStore");

const publishedRow = {
  ...row, title: "Published source",
  source: { kind: "publication", publicationId: "publication_one", retained: true }
};
panel.draftSession.activeDraftId = publishedRow.id;
const publishedRender = panel.render();
pending.at(-1)([publishedRow, { ...row, id: "other-draft" }]);
await publishedRender;
assert.equal(root.children[1].children.length, 2, "retained published drafts must not hide the other drafts");
const publishedCard = root.children[1].children[0];
const publishedTools = publishedCard.children[0].children[1];
assert.equal(publishedTools.children.length, 3, "the published source keeps its rename and delete controls");
assert.equal(publishedTools.children[2].disabled, true, "deleting a published source is disabled");
const publishedActions = publishedCard.children[1];
assert.equal(publishedActions.children[0].disabled, true, "moving a published source is disabled");
publishedTools.children[1].onclick({ stopPropagation() {} });
const publishedRename = publishedCard.children.at(-1);
publishedRename.children[0].value = "Renamed published source";
await publishedRename.children[1].children[1].onclick({ stopPropagation() {} });
assert.deepEqual(renamed.at(-1), [publishedRow.id, "Renamed published source"], "renaming a published source remains available in the editor");
let discarded = false;
let closed = false;
panel.onApplyDraftChanges = async () => ({ source: { title: "Renamed published source" } });
panel.documents = {
  async saveCurrentContext() {},
  async discardDraft() { discarded = true; return true; },
  async closeDraft() { closed = true; return true; }
};
await publishedActions.children[1].onclick({ stopPropagation() {} });
assert.equal(discarded, false, "applying publication edits must keep the retained source");
const closing = publishedActions.children[2].onclick({ stopPropagation() {} });
await new Promise(resolve => setImmediate(resolve));
pending.at(-1)([publishedRow]);
await closing;
assert.equal(closed, true, "closing the editor must use the nondestructive operation");
assert.equal(discarded, false);
const releasedRender = panel.render();
pending.at(-1)([{ ...publishedRow, source: null, messageAst: { children: [{ type: "paragraph" }] } }]);
await releasedRender;
const releasedCard = root.children[1].children[0];
assert.equal(releasedCard.children[0].children[1].children[2].disabled, false, "unlinking a publication enables draft deletion");
assert.notEqual(releasedCard.children[1].children[0].disabled, true, "unlinking a publication enables transfer to a project");

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
