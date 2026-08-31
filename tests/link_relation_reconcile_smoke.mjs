import assert from "node:assert/strict";
import { LinkRelationStore } from "../js/links/LinkRelationStore.js?v=1.5.9";
const values = new Map();
const db = { async get(s,k,f){return values.get(`${s}:${k}`)??f}, async put(s,k,v){values.set(`${s}:${k}`,structuredClone(v))}, async delete(s,k){values.delete(`${s}:${k}`)}, async all(s){return [...values].filter(([k])=>k.startsWith(`${s}:`)).map(([,value])=>({value}))} };
const store = new LinkRelationStore({ db });
const relation = await store.create({ source:{kind:"draft",id:"d1"}, target:{kind:"external",url:"https://t.me/x/1"} });
assert.deepEqual(await store.reconcileSource({kind:"draft",id:"d1"},{children:[]}), [relation.id]);
assert.equal(await store.get(relation.id), null);
console.log("link_relation_reconcile_smoke: OK");
