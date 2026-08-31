import assert from 'node:assert/strict';
import { EventBus } from '../js/core/EventBus.js?v=1.5.9';
import { BlockTree } from '../js/core/BlockTree.js?v=1.5.9';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectEditorSession } from '../js/project/ProjectEditorSession.js?v=1.5.9';
import { ProjectGraphReconciler, firstHeadingText } from '../js/project/ProjectGraphReconciler.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores=new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key)?structuredClone(s.get(key)):fallback; }
  async put(store,key,value){ this.#s(store).set(key,structuredClone(value)); return value; }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}
class ScratchStorage {
  constructor(){ this.value={id:'root',type:'document',props:{},children:[]}; }
  save(value){ this.value=structuredClone(value); }
  load(){ return structuredClone(this.value); }
}

const events=new EventBus();
const db=new MemoryDb();
const store=new ProjectStore({db,events});
const tree=new BlockTree();
const session=new ProjectEditorSession({store,tree,storage:new ScratchStorage(),db,events,autosaveDelay:5});
const reconciler=new ProjectGraphReconciler({store,events,delay:0});
reconciler.start();

let project=await store.createProject({title:'Heading Graph',firstPostTitle:'Карта'});
const mapHostId=project.posts[0].id;
const rootMapId=project.structure.rootMapId;
assert.equal(firstHeadingText(project.posts[0].messageAst),'Карта','new project post gets Heading from title');
let made=await store.createPost(project.id,{title:'Целевой пост'});
project=made.project;
const targetId=made.post.id;
assert.equal(firstHeadingText(made.post.messageAst),'Целевой пост','new post gets Heading from title');

// The Map is created with the Project. Its slots and child backlinks are canonical.
await session.openProject(project.id,{postId:mapHostId});
session.scheduleAutosave();
await session.saveNow();
await reconciler.reconcile(project.id);
project=await store.getProject(project.id);
let host=project.posts.find(p=>p.id===mapHostId);
let target=project.posts.find(p=>p.id===targetId);
assert.equal(host.messageAst.children.find(n=>n.type==='project_post_map').props.slots[0].text,'Целевой пост');
assert.equal(tree.root.children.find(n=>n.type==='project_post_map').props.slots[0].text,'Целевой пост','reconciled active AST flows back into Canvas');
assert.equal(target.messageAst.children.filter(n=>n.type==='project_map_backlink'&&n.props?.targetMapId===rootMapId).length,1,'Map relation creates managed backlink');

// Renaming the Project post is title -> Heading -> Map slot.
await session.openPost(targetId);
await session.renamePost(targetId,'Новое имя');
assert.equal(firstHeadingText(tree.root),'Новое имя','rename updates live main Heading');
await reconciler.reconcile(project.id);
project=await store.getProject(project.id);
host=project.posts.find(p=>p.id===mapHostId);
assert.equal(host.messageAst.children.find(n=>n.type==='project_post_map').props.slots[0].text,'Новое имя','rename propagates to Map slot');

// Editing the Heading is Heading -> post.title -> Map slot.
const heading=tree.root.children.find(n=>n.type==='heading');
heading.props.text='Имя из Heading';
session.scheduleAutosave();
await session.saveNow();
await reconciler.reconcile(project.id);
project=await store.getProject(project.id);
target=project.posts.find(p=>p.id===targetId);
host=project.posts.find(p=>p.id===mapHostId);
assert.equal(target.title,'Имя из Heading','Heading edit updates Project post title');
assert.equal(host.messageAst.children.find(n=>n.type==='project_post_map').props.slots[0].text,'Имя из Heading','Heading edit propagates to linked Map');

// Reconciler corrections to an active Map host must not be overwritten by the next edit.
await session.openPost(mapHostId);
const liveSlot=tree.root.children.find(n=>n.type==='project_post_map').props.slots[0];
liveSlot.text='BROKEN LOCAL DERIVED TEXT';
session.scheduleAutosave();
await session.saveNow();
await reconciler.reconcile(project.id);
assert.equal(tree.root.children.find(n=>n.type==='project_post_map').props.slots[0].text,'Имя из Heading','canonical graph correction returns to active tree');

reconciler.stop();
console.log('project_heading_graph_session_smoke: OK');
