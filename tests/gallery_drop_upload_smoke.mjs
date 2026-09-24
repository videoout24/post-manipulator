import assert from "node:assert/strict";
import fs from "node:fs";
import { activeGalleryUploadTopic } from "../js/gallery/GalleryView.js";
import { dataTransferMayContainFiles, filesFromDataTransfer } from "../js/core/FileDrop.js";

const linuxFile = { name: "linux-photo.png", type: "image/png" };
const linuxTransfer = {
  files: [],
  items: [{ kind: "file", type: "image/png", getAsFile: () => linuxFile }],
  types: ["text/uri-list"]
};
assert.equal(dataTransferMayContainFiles(linuxTransfer), true,
  "Linux file drags must be accepted while DataTransfer.files is protected during dragover");
assert.deepEqual(filesFromDataTransfer(linuxTransfer), [linuxFile],
  "Linux drops must fall back to DataTransferItem.getAsFile()");
assert.equal(dataTransferMayContainFiles({ files: [], items: [], types: ["text/uri-list"] }), true,
  "Linux URI-list drags must allow the drop event before file data becomes readable");

const topics = [
  { threadId: 7, name: "Photos" },
  { threadId: 8, name: "Removed", telegramDeleted: true }
];
assert.equal(activeGalleryUploadTopic(topics, "all"), null, "All is not an upload destination");
assert.equal(activeGalleryUploadTopic(topics, "none"), null, "No topic is not an upload destination");
assert.deepEqual(activeGalleryUploadTopic(topics, "7"), topics[0], "the active topic is the drop destination");
assert.equal(activeGalleryUploadTopic(topics, "8"), null, "a locally retained deleted topic cannot receive uploads");

const view = fs.readFileSync(new URL("../js/gallery/GalleryView.js", import.meta.url), "utf8");
assert.match(view, /addEventListener\("dragenter", show\)/);
assert.match(view, /addEventListener\("dragover", show\)/);
assert.match(view, /addEventListener\("drop"/);
assert.match(view, /filesFromDataTransfer\(event\.dataTransfer\)/);
assert.match(view, /requestTextDialog\([\s\S]*?gallery\.galleryView\.uploadDroppedFiles/);
assert.match(view, /gallery\.uploadFiles\(files, \{ threadId: Number\(topic\.threadId\), caption \}\)/,
  "dropped files must use one requested caption for the whole batch");

console.log("gallery_drop_upload_smoke: OK");
