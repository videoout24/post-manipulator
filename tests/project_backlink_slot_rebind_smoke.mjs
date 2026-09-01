import assert from 'node:assert/strict';
import { EventBus } from '../js/core/EventBus.js?v=1.5.9';
import { BlockTree } from '../js/core/BlockTree.js?v=1.5.9';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectEditorSession } from '../js/project/ProjectEditorSession.js?v=1.5.9';
import { t } from '../js/i18n/index.js?v=1.8.0';

class MemoryDb {
  constructor(){ this.stores=new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key)?structuredClone(s.get(key)):fallback; }
  async put(store,key,value){ this.#s(store).set(key,structuredClone(value)); return value; }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}
class ScratchStorage { save(){} load(){ return {id:'root',type:'document',props:{},children:[]}; } }

const events=new EventBus();
const db=new MemoryDb();
const store=new ProjectStore({db,events});
const tree=new BlockTree();
const session=new ProjectEditorSession({store,tree,storage:new ScratchStorage(),db,events});

let project=await store.createProject({title:'Fixed backlink',firstPostTitle:'Map'});
const rootMapId=project.structure.rootMapId;
const made=await store.createPost(project.id,{title:'Child'});
project=made.project;
const child=made.post;
const slot=project.posts[0].messageAst.children.find(node=>node.type==='project_post_map').props.slots[0];
const backlink=child.messageAst.children.find(node=>node.type==='project_map_backlink');

assert.equal(backlink.props.targetMapId,rootMapId);
assert.equal(backlink.props.targetSlotId,slot.id);
await session.openProject(project.id,{postId:child.id});
await assert.rejects(
  () => session.rebindBacklinkRelation(backlink.id,{targetMapId:'another-map',targetSlotId:'another-slot'}),
  error => error.message === t('project.projectEditorSession.backToMapAlwaysLeadsToThe')
);

// Even a malformed direct save is repaired to the only allowed target.
const malformed=structuredClone(child.messageAst);
malformed.children.find(node=>node.type==='project_map_backlink').props.targetMapId='another-map';
await store.savePostAst(project.id,child.id,malformed);
project=await store.getProject(project.id);
const repaired=project.posts.find(post=>post.id===child.id).messageAst.children.find(node=>node.type==='project_map_backlink');
assert.equal(repaired.props.targetMapId,rootMapId);
assert.equal(repaired.props.targetSlotId,slot.id);

console.log('project_backlink_slot_rebind_smoke: OK');
