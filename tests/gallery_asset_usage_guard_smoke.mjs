import assert from "node:assert/strict";
import { GalleryAssetInUseError, GalleryCore } from "../js/gallery/GalleryCore.js?v=1.5.9";

const assetNode = id => ({ id: `node_${id}`, type: "photo", props: { galleryId: id, fileId: "file" }, children: [] });
const ast = (...children) => ({ id: "root", type: "document", props: {}, children });
const removed = [];
let projects = [{
  id: "project_1",
  title: "Проект",
  posts: [
    { id: "post_1", title: "Черновой пост", publication: { state: "draft" }, messageAst: ast(assetNode("asset_project")) },
    { id: "post_2", title: "Публикация", publication: { state: "published" }, messageAst: ast(assetNode("asset_published")) }
  ]
}];
let drafts = [{ id: "draft_1", title: "Черновик", messageAst: ast(assetNode("asset_draft")) }];

const core = new GalleryCore({
  projects: { async listProjects() { return projects; } },
  drafts: { async list() { return drafts; } },
  store: { async remove(id) { removed.push(id); } },
  thumbnails: { async remove(id) { removed.push(`thumb:${id}`); } },
  telegramCore: {},
  client: {}
});

for (const [id, kind] of [["asset_project", "project"], ["asset_draft", "draft"], ["asset_published", "published"]]) {
  await assert.rejects(
    core.removeAsset(id),
    error => error instanceof GalleryAssetInUseError && error.usages.some(usage => usage.kind === kind)
  );
}
assert.deepEqual(removed, [], "referenced assets must not be removed");

projects = [];
drafts = [];
await core.removeAsset("asset_unused");
assert.deepEqual(removed, ["asset_unused", "thumb:asset_unused"]);

console.log("gallery_asset_usage_guard_smoke: OK");
