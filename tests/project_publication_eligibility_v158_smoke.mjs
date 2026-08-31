import assert from 'node:assert/strict';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectIndex } from '../js/project/ProjectIndex.js?v=1.5.9';
import { getProjectPostPublicationEligibility } from '../js/project/ProjectPublicationEligibility.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores=new Map(); }
  #s(n){ if(!this.stores.has(n)) this.stores.set(n,new Map()); return this.stores.get(n); }
  async get(s,k,f=null){ const m=this.#s(s); return m.has(k)?structuredClone(m.get(k)):f; }
  async put(s,k,v){ this.#s(s).set(k,structuredClone(v)); return v; }
  async delete(s,k){ return this.#s(s).delete(k); }
  async all(s){ return [...this.#s(s)].map(([key,value])=>({key,value:structuredClone(value)})); }
}
const store = new ProjectStore({ db:new MemoryDb() });
let project = await store.createProject({ title:'Eligibility', firstPostTitle:'Map' });
for (const title of ['Part A','Part B','Part C']) project=(await store.createPost(project.id,{title})).project;
const [mapPost,a,b,c] = project.posts;
let index=new ProjectIndex(project);
assert.equal(getProjectPostPublicationEligibility(project,mapPost.id,index).eligible,true,'map host can publish first');
assert.equal(getProjectPostPublicationEligibility(project,a.id,index).eligible,false,'first child waits for the map post');
assert.equal(getProjectPostPublicationEligibility(project,b.id,index).eligible,false,'later posts wait for every predecessor');
assert.equal(getProjectPostPublicationEligibility(project,c.id,index).eligible,false,'there are no detached Project posts');

await store.updateProject(project.id,draft=>{
  draft.posts.find(p=>p.id===mapPost.id).publication.state='published';
},'test-published');
project=await store.getProject(project.id);
index=new ProjectIndex(project);
assert.equal(getProjectPostPublicationEligibility(project,a.id,index).eligible,true,'linked post becomes eligible after map host publication');
assert.equal(getProjectPostPublicationEligibility(project,b.id,index).eligible,false);
await store.updateProject(project.id,draft=>{
  draft.posts.find(p=>p.id===a.id).publication.state='published';
},'test-published-second');
project=await store.getProject(project.id);
assert.equal(getProjectPostPublicationEligibility(project,b.id,new ProjectIndex(project)).eligible,true,'the next post becomes available only after the previous one');
console.log('project_publication_eligibility_v158_smoke: OK');
