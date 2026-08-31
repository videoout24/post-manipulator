import assert from 'node:assert/strict';
import { ProjectStore, getProjectRootMap } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectIndex } from '../js/project/ProjectIndex.js?v=1.5.9';
import { ProjectValidator } from '../js/project/ProjectValidator.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores = new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key) ? structuredClone(s.get(key)) : fallback; }
  async put(store,key,value){ this.#s(store).set(key, structuredClone(value)); return value; }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}

const store = new ProjectStore({ db:new MemoryDb() });
let project = await store.createProject({title:'Linear graph',firstPostTitle:'Entry'});
const root = project.posts[0];
const map = getProjectRootMap(project);
assert.deepEqual(root.messageAst.children.map(node=>node.type), ['heading','project_post_map']);
assert.equal(map.props.slots.length, 0);

const first = await store.createPost(project.id,{title:'First'});
const second = await store.createPost(project.id,{title:'Second'});
project = second.project;
const currentMap = getProjectRootMap(project);
assert.deepEqual(currentMap.props.slots.map(slot=>slot.targetPostId), [first.post.id, second.post.id]);
for (const [index, post] of project.posts.slice(1).entries()) {
  const backlink = post.messageAst.children.find(node=>node.type==='project_map_backlink');
  assert.equal(backlink.props.targetMapId, project.structure.rootMapId);
  assert.equal(backlink.props.targetSlotId, currentMap.props.slots[index].id);
  assert.equal(post.messageAst.children.filter(node=>node.type==='project_post_map').length, 0);
}

project = await store.movePost(project.id, second.post.id, 'up');
assert.deepEqual(project.posts.map(post=>post.id), [root.id, second.post.id, first.post.id]);
assert.deepEqual(getProjectRootMap(project).props.slots.map(slot=>slot.targetPostId), [second.post.id, first.post.id]);

// A direct save keeps ordinary content and restores only the required blocks.
await store.savePostAst(project.id, root.id, {id:'root',type:'document',props:{},children:[{id:'p',type:'paragraph',props:{text:'broken'},children:[]}]});
project = await store.getProject(project.id);
assert.deepEqual(project.posts[0].messageAst.children.map(node=>node.type), ['paragraph','heading','project_post_map']);
assert.equal(new ProjectValidator().validate(project,new ProjectIndex(project)).length,0);

console.log('project graph linear smoke: OK');
