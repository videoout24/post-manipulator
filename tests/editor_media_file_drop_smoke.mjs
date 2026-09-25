import assert from "node:assert/strict";
import fs from "node:fs";
import { MediaAssetBinder } from "../js/editor/MediaAssetBinder.js?v=1.11.4";
import { TreeView } from "../js/editor/TreeView.js";

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

const pickerUploadCalls = [];
const pickerAssignments = [];
const pickerSelections = [];
const originalDocument = globalThis.document;
globalThis.document = {
  addEventListener() {},
  body: { classList: { toggle() {}, remove() {} } }
};
const pickerTreeView = new TreeView({
  root: { contains: () => false },
  tree: {},
  registry: { get: () => ({ name: "Photo" }) },
  textareaSizing: { id: "sizing" },
  requestMediaUpload: async options => {
    pickerUploadCalls.push(options);
    return { assets: [firstPhoto], partialError: null };
  },
  mediaBinder: {
    async assignUploaded(nodeId, assets) {
      pickerAssignments.push({ nodeId, assets });
      return { assigned: assets, incompatible: [], unassigned: [] };
    }
  },
  controller: {
    select(nodeId) { pickerSelections.push(nodeId); },
    reportError(error) { throw new Error(error); }
  },
  events: { emit() {} }
});
globalThis.document = originalDocument;
await pickerTreeView.uploadDroppedFilesToBlock(node, {
  files: [],
  items: [],
  types: ["text/uri-list"]
});
assert.equal(pickerUploadCalls.length, 1,
  "a URI-only Linux drop on a photo block must still enter the upload flow");
assert.equal(pickerUploadCalls[0].selectFiles, true);
assert.equal(pickerUploadCalls[0].autoOpenFilePicker, true);
assert.deepEqual(pickerSelections, [node.id]);
assert.deepEqual(pickerAssignments, [{ nodeId: node.id, assets: [firstPhoto] }]);

const treeView = fs.readFileSync(new URL("../js/editor/TreeView.js", import.meta.url), "utf8");
const dialog = fs.readFileSync(new URL("../js/gallery/GalleryUploadDialog.js", import.meta.url), "utf8");
const workspace = fs.readFileSync(new URL("../js/app/createEditorWorkspace.js", import.meta.url), "utf8");
assert.equal((treeView.match(/uploadDroppedFilesToBlock\(node, e\.dataTransfer\)/g) || []).length, 2,
  "both the photo card and its inner drop zone must enter the Linux-safe upload flow");
assert.match(dialog, /data-upload-files type="file"/,
  "the fallback dialog must contain a real system file input");
assert.match(dialog, /choose\.addEventListener\("click"[\s\S]*?fileInput\.click\(\)/,
  "the visible chooser button must open the system picker from a user click");
assert.match(dialog, /fileInput\.addEventListener\("change"[\s\S]*?selectedFiles = nextFiles/,
  "selected Linux files must replace the unavailable drop payload");
assert.match(dialog, /gallery\.createTopic\(topicName\.value\.trim\(\)\)/,
  "the upload dialog must support creating a topic");
assert.match(dialog, /gallery\.uploadFiles\(selectedFiles, \{ threadId, caption: caption\.value \}\)/,
  "one caption must be applied to the dropped file batch through GalleryCore");
assert.match(workspace, /selectFiles,\s*autoOpenFilePicker/,
  "the editor workspace must forward the photo block's picker fallback options");

console.log("editor_media_file_drop_smoke: OK");
