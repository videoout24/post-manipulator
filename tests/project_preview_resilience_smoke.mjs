import assert from 'node:assert/strict';
import { TelegramApiError } from '../js/telegram/TelegramClient.js?v=1.5.9';
import { ProjectPreviewTransport } from '../js/telegram/ProjectPreviewTransport.js?v=1.5.9';
import { ProjectStore } from '../js/project/ProjectStore.js?v=1.5.9';
import { ProjectPreviewSync } from '../js/project/ProjectPreviewSync.js?v=1.5.9';

class MemoryDb {
  constructor(){ this.stores = new Map(); }
  #s(name){ if(!this.stores.has(name)) this.stores.set(name,new Map()); return this.stores.get(name); }
  async get(store,key,fallback=null){ const s=this.#s(store); return s.has(key) ? structuredClone(s.get(key)) : fallback; }
  async put(store,key,value){ this.#s(store).set(key, structuredClone(value)); return value; }
  async delete(store,key){ return this.#s(store).delete(key); }
  async all(store){ return [...this.#s(store)].map(([key,value])=>({key,value:structuredClone(value)})); }
}

// TelegramApiError must classify both edit and delete variants as a missing projection.
for (const description of [
  'Bad Request: message to edit not found',
  'Bad Request: message to delete not found',
  'Bad Request: message not found',
  'Bad Request: MESSAGE_ID_INVALID'
]) {
  const error = new TelegramApiError(description, { errorCode: 400, description });
  assert.equal(error.isMessageMissing(), true, description);
}

// A manually deleted preview message is recreated by syncEnvelope instead of surfacing
// a fatal error to Project state.
const binding = { async getSlot(){ return { status:'bound', chatId:-100500 }; }, async markUnavailable(){} };
const recreatedClient = {
  async editRichMessage(){
    throw new TelegramApiError('Bad Request: message to edit not found', {
      method:'editMessageText', errorCode:400, description:'Bad Request: message to edit not found'
    });
  },
  async sendRichMessage(){ return { message_id: 901 }; },
  async deleteMessage(){ return true; }
};
const transport = new ProjectPreviewTransport({ client: recreatedClient, previewChannelBinding: binding });
const recreated = await transport.syncEnvelope(123, { richMessage:{ type:'message', blocks:[] }, replyMarkup:undefined });
assert.equal(recreated.action, 'recreated');
assert.equal(recreated.messageId, 901);

// A manually deleted message is also equivalent to successful deployment cleanup.
recreatedClient.deleteMessage = async () => {
  throw new TelegramApiError('Bad Request: message to delete not found', {
    method:'deleteMessage', errorCode:400, description:'Bad Request: message to delete not found'
  });
};
assert.equal(await transport.deleteDeployment({ chatId:-100500, messageId:123 }), true);

// Project removal is per-post/best-effort. A real transient failure keeps only that
// deployment retryable; successfully deleted or stale-channel records are forgotten.
const db = new MemoryDb();
const store = new ProjectStore({ db });
let project = await store.createProject({ title:'Resilience', firstPostTitle:'A' });
let created = await store.createPost(project.id,{ title:'B' }); project=created.project;
created = await store.createPost(project.id,{ title:'C' }); project=created.project;
const [a,b,c] = project.posts.map(post=>post.id);
await store.setPostDeployment(project.id,a,'preview',{ chatId:-100500,messageId:11,url:'x' });
await store.setPostDeployment(project.id,b,'preview',{ chatId:-100500,messageId:12,url:'y' });
await store.setPostDeployment(project.id,c,'preview',{ chatId:-100999,messageId:13,url:'z' });

const deleteCalls=[];
let failB=true;
const bestEffortTransport={
  async deleteDeployment(record){
    deleteCalls.push(Number(record.messageId));
    if (Number(record.messageId)===12 && failB) throw new Error('temporary network failure');
    if (Number(record.chatId)!==-100500) return false;
    return true;
  }
};
const sync = new ProjectPreviewSync({ store, transport:bestEffortTransport });
const firstRemoval = await sync.remove(project.id);
assert.equal(firstRemoval.partial,true);
assert.equal(firstRemoval.failed.length,1);
assert.equal(firstRemoval.remaining,1);
project=await store.getProject(project.id);
assert.equal(project.posts.find(p=>p.id===a).deployments.preview,undefined,'successful delete clears local deployment');
assert(project.posts.find(p=>p.id===b).deployments.preview,'transient failure stays retryable');
assert.equal(project.posts.find(p=>p.id===c).deployments.preview,undefined,'old-channel record can be forgotten without blocking cleanup');

failB=false;
const secondRemoval=await sync.remove(project.id);
assert.equal(secondRemoval.partial,false);
assert.equal(secondRemoval.remaining,0);
project=await store.getProject(project.id);
assert(project.posts.every(post=>!post.deployments.preview));

console.log('Project preview resilience smoke: OK');
