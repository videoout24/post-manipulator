import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { Validator } from "../js/core/Validator.js?v=1.5.9";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.5.9";
import { registerProjectBlocks } from "../js/blocks/registerProjectBlocks.js?v=1.5.9";
import { ProjectCompiler } from "../js/project/ProjectCompiler.js?v=1.5.9";
import { ProjectIndex } from "../js/project/ProjectIndex.js?v=1.5.9";
import { ProjectValidator } from "../js/project/ProjectValidator.js?v=1.5.9";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.5.9";
import { parseProjectImportText } from "../js/project/ProjectImport.js?v=1.7.15";

const formatting = createTelegramFormattingRegistry();
const properties = createDefaultPropertyRegistry(formatting);
const registry = new BlockRegistry(properties);
registerTelegramCore(registry);
registerProjectBlocks(registry);
const richValidator = new Validator(registry);
const projectValidator = new ProjectValidator({ richMessageValidator: richValidator });
const compiler = new ProjectCompiler();
const renderer = new TelegramRenderer(registry);
const projects = [];
const mediaPaths = new Set();

for (let projectNumber = 1; projectNumber <= 20; projectNumber += 1) {
  const filename = `project-${pad(projectNumber)}.json`;
  const text = await readFile(new URL(`../data/test-projects/${filename}`, import.meta.url), "utf8");
  const parsed = parseProjectImportText(text);
  assert.equal(parsed.length, 1, `${filename} must contain one project`);
  const project = parsed[0];
  projects.push(project);
  assert.equal(project.posts.length, 10, `${filename} post count`);
  assert.equal(new Set(project.posts.map(post => post.id)).size, 10, `${filename} post IDs`);

  const index = new ProjectIndex(project);
  assert.deepEqual(projectValidator.validate(project, index), [], `${filename} source validation`);
  for (const [postIndex, post] of project.posts.entries()) {
    const topLevel = post.messageAst.children || [];
    const nodes = collectNodes(post.messageAst);
    const content = nodes.filter(node => !["document", "heading", "project_post_map", "project_map_backlink"].includes(node.type));
    assert.ok(content.length >= 5, `${filename} post ${postIndex + 1} has at least five content blocks`);
    assert.equal(topLevel[0]?.type, "heading", `${filename} post ${postIndex + 1} heading position`);
    assert.equal(
      topLevel[1]?.type,
      postIndex === 0 ? "project_post_map" : "project_map_backlink",
      `${filename} post ${postIndex + 1} project navigation position`
    );
    if (topLevel.some(node => node.type === "footer")) {
      assert.equal(topLevel.at(-1)?.type, "footer", `${filename} post ${postIndex + 1} footer position`);
    }
    assert.equal(nodes.filter(node => node.type === "heading").length, 1);
    assert.equal(nodes.filter(node => node.type === "project_post_map").length, postIndex === 0 ? 1 : 0);
    assert.equal(nodes.filter(node => node.type === "project_map_backlink").length, postIndex === 0 ? 0 : 1);
    for (const node of nodes.filter(node => node.type === "photo")) mediaPaths.add(node.props.fileId);
    for (const node of nodes.filter(node => node.type === "list")) {
      const modes = new Set((node.props?.items || []).map(item => String(item?.type || "").trim() ? "ordered" : "unordered"));
      assert.equal(modes.size, 1, `${filename} post ${postIndex + 1} list mode`);
    }

    const compiled = compiler.compilePost(project, post.id, { index });
    assert.deepEqual(richValidator.validate(compiled), [], `${filename} post ${postIndex + 1} compiled validation`);
    assert.doesNotThrow(() => renderer.renderEnvelope(compiled));
  }
}

assert.equal(projects.length, 20);
for (let imageNumber = 1; imageNumber <= 10; imageNumber += 1) {
  const path = `./assets/test-projects/test-${pad(imageNumber)}.png`;
  assert.ok(mediaPaths.has(path), `${path} is referenced by the fixtures`);
  await access(new URL(`../assets/test-projects/test-${pad(imageNumber)}.png`, import.meta.url));
}

const bundleText = await readFile(new URL("../data/test-projects-bundle.json", import.meta.url), "utf8");
assert.equal(parseProjectImportText(bundleText).length, 20);

console.log("test project fixtures smoke: OK (20 projects, 200 posts, 10 images)");

function collectNodes(root) {
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return nodes;
}

function pad(value) { return String(value).padStart(2, "0"); }
