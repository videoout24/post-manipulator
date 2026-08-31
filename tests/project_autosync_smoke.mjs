import assert from 'node:assert/strict';
import { EventBus } from '../js/core/EventBus.js?v=1.5.9';
import { createTelegramFormattingRegistry } from '../js/core/FormattingRegistry.js?v=1.5.9';
import { createDefaultPropertyRegistry } from '../js/core/PropertyRegistry.js?v=1.5.9';
import { BlockRegistry } from '../js/core/BlockRegistry.js?v=1.5.9';
import { Validator } from '../js/core/Validator.js?v=1.5.9';
import { registerTelegramCore } from '../js/blocks/registerCoreBlocks.js?v=1.5.9';
import { registerProjectBlocks } from '../js/blocks/registerProjectBlocks.js?v=1.5.9';
import { TelegramRenderer } from '../js/telegram/TelegramRenderer.js?v=1.5.9';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectCompiler } from '../js/project/ProjectCompiler.js?v=1.5.9';
import { ProjectValidator } from '../js/project/ProjectValidator.js?v=1.5.9';
import { ProjectGraphReconciler } from '../js/project/ProjectGraphReconciler.js?v=1.5.9';
import { ProjectPreviewSync } from '../js/project/ProjectPreviewSync.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores=new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key)?structuredClone(s.get(key)):fallback; }
  async put(store,key,value){ this.#s(store).set(key,structuredClone(value)); }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const events=new EventBus();
const store=new ProjectStore({db:new MemoryDb(),events});
const reconciler=new ProjectGraphReconciler({store,events,delay:10});
reconciler.start();
const formatting=createTelegramFormattingRegistry();
const registry=new BlockRegistry(createDefaultPropertyRegistry(formatting));
registerTelegramCore(registry); registerProjectBlocks(registry);
const validator=new ProjectValidator({richMessageValidator:new Validator(registry)});
const compiler=new ProjectCompiler();
const renderer=new TelegramRenderer(registry);
class Transport {
  constructor(){ this.next=100; this.channel={chatId:-100500}; this.syncCalls=[]; }
  async getChannel(){ return this.channel; }
  render(tree){ return renderer.renderEnvelope(tree); }
  async sendEnvelope(){ return {message_id:++this.next}; }
  async syncEnvelope(id){ this.syncCalls.push(Number(id)); return {action:'edited',message:{message_id:Number(id)}}; }
  async deleteDeployment(){ return true; }
}
const transport=new Transport();
const sync=new ProjectPreviewSync({store,compiler,validator,transport,events,autoSyncDelay:120});
let project=await store.createProject({title:'Auto',firstPostTitle:'Map'});
const mapHost=project.posts[0].id;
let made=await store.createPost(project.id,{title:'Target'}); project=made.project; const target=made.post.id;
made=await store.createPost(project.id,{title:'Unrelated'}); project=made.project; const unrelated=made.post.id;
await store.savePostAst(project.id,target,{id:'root',type:'document',props:{},children:[{id:'h',type:'heading',props:{text:'Before',level:2},children:[]}]});
await store.savePostAst(project.id,mapHost,{id:'root',type:'document',props:{},children:[{id:'m',type:'project_post_map',props:{mapId:'auto_map',numbering:'numeric',prefix:'',separator:'. ',slots:[{id:'s',targetPostId:target,text:''}]},children:[]}]});
await store.savePostAst(project.id,unrelated,{id:'root',type:'document',props:{},children:[{id:'p',type:'paragraph',props:{text:'Unrelated'},children:[]}]});
await reconciler.reconcile(project.id);
await sync.sync(project.id);
project=await store.getProject(project.id);
const idOf=postId=>Number(project.posts.find(p=>p.id===postId).deployments.preview.messageId);
transport.syncCalls=[];
const ast=structuredClone(project.posts.find(p=>p.id===target).messageAst);
ast.children.find(n=>n.type==='heading').props.text='After';
await store.savePostAst(project.id,target,ast);
await sleep(450);
assert(transport.syncCalls.includes(idOf(target)),'edited post must autosync');
assert(transport.syncCalls.includes(idOf(mapHost)),'dependent Map host must autosync');
assert(!transport.syncCalls.includes(idOf(unrelated)),'unrelated post must not autosync');
sync.stop(); reconciler.stop();
console.log('Project autosync v1.4.2 smoke: OK');
