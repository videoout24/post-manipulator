import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTelegramFormattingRegistry } from '../js/core/FormattingRegistry.js?v=1.5.9';
import { createDefaultPropertyRegistry } from '../js/core/PropertyRegistry.js?v=1.5.9';
import { BlockRegistry } from '../js/core/BlockRegistry.js?v=1.5.9';
import { registerProjectBlocks } from '../js/blocks/registerProjectBlocks.js?v=1.5.9';

const properties=createDefaultPropertyRegistry(createTelegramFormattingRegistry());
const registry=new BlockRegistry(properties);
registerProjectBlocks(registry);
const backlink=registry.get('project_map_backlink');
const bindings=registry.propertyBindings(backlink);
assert(bindings.some(b=>b.property==='project.backlink.relation' && b.editor==='project-backlink-relation'));
assert(!bindings.some(b=>b.property==='project.backlink.targetMap'),'raw targetMap selector is replaced by combined relation editor');

const inspector=fs.readFileSync(new URL('../js/editor/BlockInspector.js',import.meta.url),'utf8');
assert(inspector.includes('project-backlink-relation-row'));
assert(inspector.includes('hasFreeSlot'));
assert(inspector.includes('targetSlotId'));
assert(inspector.includes('rebindBacklinkRelation'));
const css=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
assert(css.includes('.project-backlink-relation-row'));
assert(css.includes('grid-template-columns: minmax(0,1fr) minmax(0,1fr)'));
console.log('project_backlink_relation_ui_contract_smoke: OK');
