import assert from 'node:assert/strict';
import { EventBus } from '../js/core/EventBus.js?v=1.5.9';
import { BlockTree } from '../js/core/BlockTree.js?v=1.5.9';
import { DraftStore } from '../js/editor/DraftStore.js?v=1.5.9';
import { DraftEditorSession } from '../js/editor/DraftEditorSession.js?v=1.5.9';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectEditorSession } from '../js/project/ProjectEditorSession.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores = new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key) ? structuredClone(s.get(key)) : fallback; }
  async put(store,key,value){ this.#s(store).set(key, structuredClone(value)); return value; }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}

const db = new MemoryDb();
const events = new EventBus();
const storage = {
  value: { id:'root',type:'document',props:{},children:[] },
  load(){ return structuredClone(this.value); },
  save(v){ this.value=structuredClone(v); },
  clear(){ this.value={id:'root',type:'document',props:{},children:[]}; }
};
const tree = new BlockTree(storage.load());
const drafts = new DraftStore({ db, events });
const draftSession = new DraftEditorSession({ store:drafts, tree, events, autosaveDelay:1 });
const projects = new ProjectStore({ db, events });
const projectSession = new ProjectEditorSession({ store:projects, tree, storage, db, events, autosaveDelay:1 });

// Draft is a live document: edits are persisted before context switches.
let draft = await drafts.create({ title:'Draft A', messageAst:{ id:'root',type:'document',props:{},children:[] } });
await projectSession.openStandaloneAst(draft.messageAst, { persist:true });
draftSession.activate(draft);
tree.root.children.push({ id:'p1', type:'paragraph', props:{ text:'saved before project' }, children:[] });
draftSession.scheduleAutosave();
await draftSession.flush();
draft = await drafts.get(draft.id);
assert.equal(draft.messageAst.children[0].props.text, 'saved before project');

// Project blocks cannot survive in Draft storage.
const sanitized = await drafts.create({
  title:'No project graph',
  messageAst:{ id:'root',type:'document',props:{},children:[
    { id:'m',type:'project_post_map',props:{mapId:'map_x',slots:[]},children:[] },
    { id:'b',type:'project_map_backlink',props:{targetMapId:'map_x'},children:[] },
    { id:'p',type:'paragraph',props:{text:'keep'},children:[] }
  ]}
});
assert.deepEqual(sanitized.messageAst.children.map(n=>n.type), ['paragraph']);

// Project edits are flushed before opening a new Draft context.
let project = await projects.createProject({ title:'P', firstPostTitle:'One' });
await draftSession.deactivate({ flush:true });
await projectSession.openProject(project.id);
const projectChild = await projectSession.createPost('Project child');
tree.root.children.push({ id:'project-note',type:'paragraph',props:{text:'project saved before draft'},children:[] });
projectSession.scheduleAutosave();
await projectSession.flush();
project = await projects.getProject(project.id);
assert(project.posts.find(post => post.id === projectChild.id).messageAst.children.some(n=>n.props?.text==='project saved before draft'));

// Draft -> Project transfer keeps source order while adding required project blocks.
const transfer = await drafts.create({ title:'Moved Draft', messageAst:{ id:'root',type:'document',props:{},children:[
  { id:'p2',type:'paragraph',props:{text:'payload'},children:[] }
] } });
const created = await projects.createPost(project.id, { title:transfer.title, messageAst:transfer.messageAst });
assert.equal(created.post.title, 'Moved Draft');
assert.equal(created.post.messageAst.children[0].props.text, 'payload');
assert.equal(created.post.messageAst.children[1].type, 'heading');
assert.equal(created.post.messageAst.children[2].type, 'project_map_backlink');

console.log('draft_lifecycle_v158_smoke: OK');
