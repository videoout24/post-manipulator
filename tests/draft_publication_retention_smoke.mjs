import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { BlockTree } from "../js/core/BlockTree.js";
import { DraftStore } from "../js/editor/DraftStore.js";
import { DraftEditorSession } from "../js/editor/DraftEditorSession.js";
import { EditorDocumentCoordinator } from "../js/editor/EditorDocumentCoordinator.js";
import { ProjectStore } from "../js/project/ProjectStore.js";
import { PublicationService } from "../js/telegram/PublicationService.js";
import { LinkRelationStore } from "../js/links/LinkRelationStore.js";
import { t } from "../js/i18n/index.js";

class MemoryDb {
  constructor() { this.stores = new Map(); }
  store(name) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name); }
  async get(store, key, fallback = null) { return structuredClone(this.store(store).get(key) ?? fallback); }
  async put(store, key, value) { this.store(store).set(key, structuredClone(value)); }
  async delete(store, key) { this.store(store).delete(key); }
  async all(store) { return [...this.store(store)].map(([key, value]) => ({ key, value: structuredClone(value) })); }
}
const ast = text => ({ id: "root", type: "document", props: {}, children: [{ id: "p", type: "paragraph", props: { text }, children: [] }] });
const db = new MemoryDb();
const events = new EventBus();
const drafts = new DraftStore({ db, events });
const projects = new ProjectStore({ db, events });
const tree = new BlockTree(ast("Original source"));
const draftSession = new DraftEditorSession({ store: drafts, tree, events });
let projectActive = false;
const projectSession = {
  isProjectActive: () => projectActive,
  async openStandaloneAst() {},
  async openProject() { projectActive = true; },
  async refreshProject() {}
};
const documents = new EditorDocumentCoordinator({ projectSession, draftSession, drafts, projects });
const links = new LinkRelationStore({ db, events });
const client = {
  async sendRichMessage() { return { message_id: 7, date: Math.floor(Date.now() / 1000) }; },
  async deleteMessage() { throw new Error("offline"); }
};
const service = new PublicationService({
  db, events, client, drafts, draftSession, documents, linkRelations: links,
  targets: { async list() { return [{ chatId: -100123, type: "channel", title: "Channel", status: "ready" }]; } },
  validator: { validate: () => [] }, renderer: { renderEnvelope: () => ({ richMessage: { blocks: [] } }) }
});
const project = await projects.createProject({ title: "Destination" });
const draft = await drafts.create({ title: "Source", messageAst: tree.toJSON(), source: { kind: "draft" } });
draftSession.activate(draft);
const record = await service.publishDraft(draft.id, -100123);
assert.equal(draftSession.activeDraftId, null, "a published Draft must leave Canvas after successful delivery");
assert.equal((await drafts.get(draft.id)).source.publicationId, record.id, "the retained source must keep its publication binding");
await documents.openDraft(draft.id);
assert.equal(draftSession.activeDraftId, draft.id, "the retained source can still be reopened explicitly");
await assert.rejects(documents.discardDraft(draft.id), error => error.message === t("editor.draftListView.deletePublishedDraftBlocked"));
assert.equal(draftSession.activeDraftId, draft.id, "a rejected deletion must keep the editor session open");
await assert.rejects(documents.moveDraftToProject(draft.id, project.id), error => error.message === t("editor.draftListView.movePublishedDraftBlocked"));
assert.equal((await projects.getProject(project.id)).posts.length, 1, "a rejected transfer must not create a project post");
await assert.rejects(service.delete(record.id), /offline/);
assert.equal((await drafts.get(draft.id)).source.publicationId, record.id, "a failed remote deletion must keep the guard");

await drafts.rename(draft.id, "Renamed published source");
assert.equal(draftSession.draft.title, "Renamed published source", "renaming must refresh the live editor");
assert.equal((await db.get("publications", record.id)).source.title, "Renamed published source",
  "renaming the retained source must keep the publication title synchronized");
tree.root.children[0].props.text = "Latest unpublished edits";
draftSession.scheduleAutosave();
await documents.closeDraft(draft.id);
assert.equal(draftSession.activeDraftId, null);
assert.equal((await drafts.get(draft.id)).messageAst.children[0].props.text, "Latest unpublished edits", "closing must save, not delete, the source");

const outgoing = await links.create({ source: { kind: "publication", id: record.id }, target: { kind: "external", url: "https://example.com" } });
client.deleteMessage = async () => true;
await service.delete(record.id);
const released = await drafts.get(draft.id);
assert.deepEqual(released.source, { kind: "draft" });
assert.equal(released.title, "Renamed published source");
assert.equal(released.messageAst.children[0].props.text, "Latest unpublished edits", "unpublishing must not overwrite local edits with the publication snapshot");
assert.deepEqual((await links.get(outgoing.id)).source, { kind: "draft", id: draft.id }, "outgoing links must remain attached to the retained source");
assert.equal(await db.get("publications", record.id), null);
const moved = await documents.moveDraftToProject(draft.id, project.id);
assert.equal(moved.post.title, "Renamed published source");
assert.equal(moved.post.messageAst.children[0].props.text, "Latest unpublished edits");
assert.equal(await drafts.get(draft.id), null, "a successful transfer removes the now-unpublished draft");
assert.equal((await projects.getProject(project.id)).posts.length, 2);

// Upgrade old publications whose original Draft was removed by earlier versions.
const legacy = {
  id: "legacy-publication", source: { kind: "draft", draftId: "legacy-draft", title: "Legacy" },
  messageId: 11, chatId: -100123, publishedAt: Date.now(), messageAst: ast("Recovered source")
};
await db.put("publications", legacy.id, legacy);
await service.initialize();
assert.equal((await drafts.get("legacy-draft")).messageAst.children[0].props.text, "Recovered source");
await assert.rejects(drafts.delete("legacy-draft"), error => error.message === t("editor.draftListView.deletePublishedDraftBlocked"));
await drafts.rename("legacy-draft", "Recovered and renamed");
await drafts.saveAst("legacy-draft", ast("Keep these newer edits"));
await service.initialize();
assert.equal((await drafts.get("legacy-draft")).title, "Recovered and renamed");
assert.equal((await drafts.get("legacy-draft")).messageAst.children[0].props.text, "Keep these newer edits", "startup must not replace an existing source snapshot");
await service.discardLocal(legacy.id);
assert.equal((await drafts.get("legacy-draft")).source, null);
await drafts.delete("legacy-draft");

// A record must protect its source even if saving the reverse binding was interrupted.
projectActive = false;
const interrupted = await drafts.create({ title: "Interrupted", messageAst: ast("Keep") });
await db.put("publications", "interrupted", { ...legacy, id: "interrupted", source: { kind: "draft", draftId: interrupted.id } });
await assert.rejects(drafts.delete(interrupted.id), error => error.message === t("editor.draftListView.deletePublishedDraftBlocked"));
await assert.rejects(documents.moveDraftToProject(interrupted.id, project.id), error => error.message === t("editor.draftListView.movePublishedDraftBlocked"));
assert.equal((await projects.getProject(project.id)).posts.length, 2);
await service.discardLocal("interrupted");
await drafts.delete(interrupted.id);

service.stop();
draftSession.destroy();
console.log("draft_publication_retention_smoke: OK");
