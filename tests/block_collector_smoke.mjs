import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BlockCollector, BLOCK_COLLECTOR_SETTINGS_KEY } from "../js/editor/BlockCollector.js";
import { BlockTree } from "../js/core/BlockTree.js";
import { EditorController } from "../js/editor/EditorController.js";
import { EventBus } from "../js/core/EventBus.js";
import { SelectionModel } from "../js/core/SelectionModel.js";

const paragraph = (id, text) => ({ id, type: "paragraph", props: { text }, children: [] });
const documentAst = (...children) => ({ id: "root", type: "document", props: {}, children });
const rows = new Map();
const db = {
  async get(store, key, fallback = null) { return rows.get(`${store}:${key}`) ?? fallback; },
  async put(store, key, value) { rows.set(`${store}:${key}`, structuredClone(value)); return value; }
};
const events = new EventBus();
const draftSession = { activeDraftId: "draft-1", active: true, isActive() { return this.active; } };
const projectSession = {
  active: false,
  activeProjectId: "project-1",
  activePostId: "post-1",
  isProjectActive() { return this.active; },
  snapshot() { return { activeProjectId: this.activeProjectId, activePostId: this.activePostId }; }
};
const tree = new BlockTree(documentAst(paragraph("draft-a", "Draft A"), paragraph("draft-b", "Draft B")));
const draftsById = new Map([["draft-1", { id: "draft-1", messageAst: tree.toJSON() }]]);
const projectsById = new Map([[
  "project-1",
  { id: "project-1", posts: [{ id: "post-1", messageAst: documentAst(paragraph("post-a", "Post A")) }] }
]]);
const drafts = { async get(id) { return structuredClone(draftsById.get(id) || null); } };
const projects = {
  async getPost(projectId, postId) {
    const post = projectsById.get(projectId)?.posts?.find(item => item.id === postId);
    return post ? structuredClone(post) : null;
  }
};
const registry = { get(type) { return { type, projectVirtual: type === "project_post_map" }; } };
const collector = new BlockCollector({ db, events, tree, drafts, projects, draftSession, projectSession, registry });
await collector.initialize();
collector.start();

await collector.toggleCurrent("draft-a");
assert.equal(collector.count(), 1);
assert.equal(collector.hasCurrent("draft-a"), true);
assert.equal(rows.get(`settings:${BLOCK_COLLECTOR_SETTINGS_KEY}`).references[0].draftId, "draft-1",
  "collector stores a source reference, not a block snapshot");

projectSession.active = true;
draftSession.active = false;
tree.root = structuredClone(projectsById.get("project-1").posts[0].messageAst);
await collector.toggleCurrent("post-a");
assert.equal(collector.count(), 2, "blocks from different posts can be accumulated");
assert.deepEqual((await collector.resolveBlocks()).map(node => node.props.text), ["Draft A", "Post A"]);

await events.emitAsync("draft:changed", {
  reason: "saved",
  draftId: "draft-1",
  draft: { id: "draft-1", messageAst: documentAst(paragraph("draft-b", "Draft B")) }
});
assert.equal(collector.count(), 1, "deleting an original block prunes its reference");

await events.emitAsync("project:changed", {
  reason: "post-deleted",
  projectId: "project-1",
  project: { id: "project-1", posts: [] }
});
assert.equal(collector.count(), 0, "deleting an original post prunes all of its block references");

tree.root = documentAst(paragraph("post-b", "Post B"));
projectsById.get("project-1").posts = [{ id: "post-1", messageAst: tree.toJSON() }];
await collector.toggleCurrent("post-b");
await collector.clear();
assert.equal(collector.count(), 0);
assert.deepEqual(rows.get(`settings:${BLOCK_COLLECTOR_SETTINGS_KEY}`).references, []);
assert.equal(collector.isCollectible({ id: "map", type: "project_post_map" }), false,
  "project-managed structural blocks are not collectible");
collector.stop();

let cloneSequence = 0;
const copyRegistry = {
  get(type) { return { type, children: { allowed: true } }; },
  cloneSubtree(source) {
    const copy = structuredClone(source);
    const remap = node => {
      node.id = `copy-${++cloneSequence}`;
      for (const child of node.children || []) remap(child);
    };
    remap(copy);
    return copy;
  }
};
const copyEvents = new EventBus();
let collectorChange = null;
copyEvents.on("tree:changed", event => { collectorChange = event; });
const targetTree = new BlockTree(documentAst(paragraph("existing", "Existing")));
const selection = new SelectionModel(copyEvents);
const controller = new EditorController({ tree: targetTree, registry: copyRegistry, validator: null, events: copyEvents, selection });
controller.setDocumentContextResolver(() => true);
const source = { id: "source", type: "group", props: {}, children: [paragraph("source-child", "Nested")] };
const inserted = controller.insertCopiedSubtrees([source]);
assert.equal(inserted.inserted.length, 1);
assert.equal(targetTree.root.children.length, 2);
assert.notEqual(inserted.inserted[0].id, source.id);
assert.notEqual(inserted.inserted[0].children[0].id, source.children[0].id);
assert.deepEqual(collectorChange.insertedIds, [inserted.inserted[0].id]);

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const treeViewSource = await readFile(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
assert.match(html, /id="insertBlockCollector"/);
assert.match(html, /id="clearBlockCollector"/);
assert.match(treeViewSource, /block-collector-toggle/);
assert.match(treeViewSource, /if \(collectorToggle\) titleWrap\.append\(collectorToggle\);[\s\S]*?titleWrap\.append\(name\);/,
  "the collector toggle must appear immediately before the block title");
assert.doesNotMatch(treeViewSource, /if \(collectorToggle\) actions\.append\(collectorToggle\);/,
  "the collector toggle must not remain in the right-side block actions");

console.log("block collector smoke: OK");
