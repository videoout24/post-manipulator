import assert from "node:assert/strict";
import fs from "node:fs";
import { MediaAssetBinder } from "../js/editor/MediaAssetBinder.js?v=1.11.4";

const node = { id: "photo-1", type: "photo", props: {}, children: [] };
const tree = { find: id => id === node.id ? node : null };
const controller = {
  updateNodeProperties(id, patch) {
    assert.equal(id, node.id);
    Object.assign(node.props, patch);
  }
};
const binder = new MediaAssetBinder({
  tree,
  controller,
  registry: { get: () => ({ name: "Photo", gallery: { acceptedTypes: ["photo"], mode: "single" } }) }
});
const video = { id: "video-1", type: "video", telegram: { fileId: "video-file" } };
const firstPhoto = { id: "photo-a", type: "photo", caption: "Batch caption", telegram: { fileId: "photo-file-a" } };
const secondPhoto = { id: "photo-b", type: "photo", telegram: { fileId: "photo-file-b" } };
const result = await binder.assignUploaded(node.id, [video, firstPhoto, secondPhoto]);

assert.deepEqual(result.assigned, [firstPhoto], "a single media block receives the first compatible upload");
assert.deepEqual(result.incompatible, [video], "incompatible uploads remain indexed in Gallery");
assert.deepEqual(result.unassigned, [secondPhoto], "additional compatible uploads remain indexed in Gallery");
assert.deepEqual(node.props, {
  galleryId: "photo-a",
  fileId: "photo-file-a",
  url: "",
  caption: "Batch caption"
});

const treeView = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
const dialog = fs.readFileSync(new URL("../js/gallery/GalleryUploadDialog.js", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../js/app/createEditorWorkspace.js", import.meta.url), "utf8");
assert.match(treeView, /dataTransferHasFiles\(e\.dataTransfer\)[\s\S]*?uploadFilesToBlock\(node, Array\.from\(e\.dataTransfer\?\.files \|\| \[\]\)\)/,
  "OS files dropped on a media block must enter the upload flow");
assert.match(dialog, /gallery\.createTopic\(topicName\.value\.trim\(\)\)/,
  "the upload dialog must support creating a topic");
assert.match(dialog, /gallery\.uploadFiles\(selectedFiles, \{ threadId, caption: caption\.value \}\)/,
  "one caption must be applied to the dropped file batch through GalleryCore");
assert.match(workspace, /requestGalleryUpload\(\{ gallery, events, files, topics, textareaSizing \}\)/,
  "the editor must compose the upload dialog with the shared GalleryCore instance");

console.log("editor_media_file_drop_smoke: OK");
