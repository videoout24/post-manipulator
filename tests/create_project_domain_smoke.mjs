import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { createProjectDomain } from "../js/app/createProjectDomain.js?v=1.5.9";

const events = new EventBus();
const db = { async get(_store, _key, fallback = null) { return fallback; }, async put() {}, async delete() {} };
const storage = { save() {}, load() { return null; } };
const tree = new BlockTree();
const richMessageValidator = { validate: () => [] };
const project = createProjectDomain({ db, events, tree, storage, richMessageValidator });

assert(Object.isFrozen(project));
for (const key of ["store", "index", "session", "graphReconciler", "compiler", "validator", "buildPreviewTree"]) {
  assert(project[key], `${key} must be exposed by the Project domain`);
}
assert.equal(project.session.store, project.store);
assert.equal(project.session.tree, tree);
assert.equal(project.graphReconciler.store, project.store);
assert.equal(project.validator.richMessageValidator, richMessageValidator);
assert.equal(project.buildPreviewTree(), tree, "standalone Editor must use the canonical tree for preview");

console.log("create_project_domain_smoke: OK");
