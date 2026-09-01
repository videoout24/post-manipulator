import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DraftStore } from '../js/editor/DraftStore.js?v=1.5.9';
import { ProjectEditorSession } from '../js/project/ProjectEditorSession.js?v=1.5.9';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const commands = fs.readFileSync(new URL('../js/editor/EditorCommandController.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../js/editor/EditorRightPanel.js', import.meta.url), 'utf8');
const documents = fs.readFileSync(new URL('../js/editor/EditorDocumentCoordinator.js', import.meta.url), 'utf8');
const session = fs.readFileSync(new URL('../js/project/ProjectEditorSession.js', import.meta.url), 'utf8');
const database = fs.readFileSync(new URL('../js/storage/AppDatabase.js', import.meta.url), 'utf8');
const databaseStores = fs.readFileSync(new URL('../js/storage/IndexedDbAppDatabase.js', import.meta.url), 'utf8');

assert.doesNotMatch(html, /id="editorActions"/);
assert.match(html, /class="canvas-editor-bar"/);
for (const id of ['newDoc','exportJson','saveMeta','previewTelegram','openDrafts','editorUndo','editorRedo']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.doesNotMatch(html, /id="saveDoc"/);
assert.doesNotMatch(html, /id="saveDraft"/);
assert.ok(html.indexOf('id="exportJson"') < html.indexOf('id="canvasStats"'));
assert.ok(html.indexOf('id="previewTelegram"') < html.indexOf('id="canvasStats"'));
assert.match(html, /data-i18n="html\.cancel"[^>]*type="submit" value="cancel"/);
assert.ok(html.indexOf('id="canvasEditorBar"') < html.indexOf('id="canvasContextBar"'));
assert.match(css, /\.canvas-editor-bar/);
assert.match(css, /#openDrafts\.active/);
assert.match(css, /\.canvas-history-actions/);
assert.match(database, /new IndexedDbAppDatabase/);
assert.match(database, /post-manipulator-bot/);
assert.match(databaseStores, /"drafts"/);
assert.match(commands, /draftStore\.create/);
assert.match(commands, /rightPanel\?\.toggleDrafts/);
assert.match(panel, /this\.mode === "drafts"/);
assert.match(documents, /projectSession\.openStandaloneAst/);
assert.match(session, /async openStandaloneAst\(/);

class FakeDb {
  constructor() { this.rows = new Map(); }
  async all() { return [...this.rows].map(([key, value]) => ({ key, value: structuredClone(value), updatedAt: value.updatedAt })); }
  async get(_store, key, fallback = null) { return this.rows.has(key) ? structuredClone(this.rows.get(key)) : fallback; }
  async put(_store, key, value) { this.rows.set(key, structuredClone(value)); return structuredClone(value); }
  async delete(_store, key) { this.rows.delete(key); }
}
const db = new FakeDb();
const store = new DraftStore({ db });
const one = await store.create({ title: 'A', messageAst: { id:'root', type:'document', props:{}, children:[] }, source:{ kind:'standalone' } });
await new Promise(resolve => setTimeout(resolve, 2));
const two = await store.create({ title: 'B', messageAst: { id:'root', type:'document', props:{}, children:[] }, source:{ kind:'project', postId:'post_2' } });
assert.equal((await store.list()).length, 2);
assert.equal((await store.list())[0].id, two.id);
await store.delete(one.id);
assert.equal((await store.list()).length, 1);
const storage = { saved:null, save(value){ this.saved = structuredClone(value); }, load(){ return this.saved; } };
const sessionDb = { async delete(){}, async get(){ return null; } };
const tree = { root:{ id:'root', type:'document', props:{}, children:[] }, toJSON(){ return structuredClone(this.root); } };
const editorSession = new ProjectEditorSession({ store:{}, tree, storage, db:sessionDb });
await editorSession.openStandaloneAst({ id:'x', type:'document', props:{}, children:[{ id:'p', type:'paragraph', props:{ text:'draft' }, children:[] }] });
assert.equal(editorSession.isProjectActive(), false);
assert.equal(tree.root.id, 'root');
assert.equal(tree.root.children[0].props.text, 'draft');
assert.equal(storage.saved.children[0].props.text, 'draft');

console.log('editor_canvas_drafts_smoke: OK');
