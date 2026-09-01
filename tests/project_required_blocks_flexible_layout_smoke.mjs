import assert from 'node:assert/strict';
import { ProjectStore, getProjectRootMap, protectedProjectNodeError } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectIndex } from '../js/project/ProjectIndex.js?v=1.5.9';
import { ProjectValidator } from '../js/project/ProjectValidator.js?v=1.5.9';
import { t } from '../js/i18n/index.js?v=1.8.0';

class MemoryDb {
  constructor(){ this.stores = new Map(); }
  #store(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(name,key,fallback=null){ const rows=this.#store(name); return rows.has(key) ? structuredClone(rows.get(key)) : fallback; }
  async put(name,key,value){ this.#store(name).set(key,structuredClone(value)); return value; }
  async delete(name,key){ return this.#store(name).delete(key); }
  async all(name){ return [...this.#store(name)].map(([key,value])=>({key,value:structuredClone(value)})); }
}

const details = (id, children) => ({ id, type:'details', props:{summary:'Группа',open:true}, children });
const paragraph = (id, text) => ({ id, type:'paragraph', props:{text}, children:[] });

const store = new ProjectStore({ db:new MemoryDb() });
let project = await store.createProject({ title:'Свободная структура', firstPostTitle:'Старт' });
const rootId = project.posts[0].id;
const originalMap = structuredClone(getProjectRootMap(project));
const originalHeading = structuredClone(project.posts[0].messageAst.children.find(node => node.type === 'heading'));
originalHeading.props.text = 'Вложенный старт';

// Ordinary content can precede both requirements and the Map/Heading can live
// inside a compatible container. Saving must not move either back to root.
await store.savePostAst(project.id, rootId, {
  id:'root', type:'document', props:{}, children:[
    paragraph('root_intro','Этот блок идёт раньше всего'),
    details('root_group',[originalMap, originalHeading])
  ]
});
project = await store.getProject(project.id);
const root = project.posts.find(post => post.id === rootId);
assert.deepEqual(root.messageAst.children.map(node => node.id), ['root_intro','root_group']);
assert.deepEqual(root.messageAst.children[1].children.map(node => node.type), ['project_post_map','heading']);
assert.equal(root.title,'Вложенный старт');
assert.equal(getProjectRootMap(project).id,originalMap.id);
assert.equal(protectedProjectNodeError(project,rootId,{ action:'property',nodeId:originalHeading.id,key:'text' }), '');

const made = await store.createPost(project.id,{ title:'Раздел' });
project = made.project;
const childId = made.post.id;
const child = project.posts.find(post => post.id === childId);
const childHeading = structuredClone(child.messageAst.children.find(node => node.type === 'heading'));
const childBacklink = structuredClone(child.messageAst.children.find(node => node.type === 'project_map_backlink'));

await store.savePostAst(project.id, childId, {
  id:'root', type:'document', props:{}, children:[
    paragraph('child_intro','Сначала произвольный блок'),
    details('child_group',[childBacklink, childHeading])
  ]
});
project = await store.getProject(project.id);
const savedChild = project.posts.find(post => post.id === childId);
assert.deepEqual(savedChild.messageAst.children.map(node => node.id), ['child_intro','child_group']);
assert.deepEqual(savedChild.messageAst.children[1].children.map(node => node.type), ['project_map_backlink','heading']);
assert.equal(protectedProjectNodeError(project,childId,{ action:'move',nodeId:childBacklink.id }), '');
assert.equal(protectedProjectNodeError(project,childId,{ action:'property',nodeId:childHeading.id,key:'text' }), '');
assert.equal(
  protectedProjectNodeError(project,childId,{ action:'remove',nodeId:childBacklink.id }),
  t('project.projectStore.theBackToMapBlockIsMandatory')
);
assert.equal(new ProjectValidator().validate(project,new ProjectIndex(project)).length,0);

console.log('project_required_blocks_flexible_layout_smoke: OK');
