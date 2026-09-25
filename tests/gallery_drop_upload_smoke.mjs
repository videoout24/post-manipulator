import assert from "node:assert/strict";
import fs from "node:fs";
import { activeGalleryUploadTopic } from "../js/gallery/GalleryView.js";
import {
  dataTransferMayContainFiles,
  filesFromDataTransfer,
  isBlobLike,
  resolveFilesForDrop,
  resolveFilesFromDataTransfer
} from "../js/core/FileDrop.js";

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
const handleFile = { name: "handle-photo.png", type: "image/png", size: 12 };
assert.deepEqual(await resolveFilesFromDataTransfer({
  files: [],
  items: [{ kind: "file", getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: "file", getFile: async () => handleFile }) }]
}), [handleFile], "Linux drops must resolve asynchronous file-system handles");
assert.deepEqual(await resolveFilesForDrop({ files: [], items: [], types: ["text/uri-list"] }), {
  files: [],
  source: "unavailable",
  pickerRequired: true
}, "URI-only WebKit drops must explicitly request the system file picker");
assert.deepEqual(await resolveFilesForDrop({
  files: [],
  items: [{ kind: "file", getAsFile: () => null, getAsFileSystemHandle: async () => null }],
  types: ["Files"]
}), {
  files: [],
  source: "unavailable",
  pickerRequired: true
}, "an empty asynchronous handle must also fall back to the picker");
const crossRealmFile = {
  name: "cross-realm.png", type: "image/png", size: 10,
  arrayBuffer: async () => new ArrayBuffer(10),
  [Symbol.toStringTag]: "File"
};
assert.equal(isBlobLike(crossRealmFile), true, "cross-realm Linux File objects must survive upload validation");

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
assert.match(view, /resolveFilesForDrop\(event\.dataTransfer\)/);
assert.match(view, /selectFiles: resolved\.pickerRequired/,
  "Gallery must open the chooser dialog when Linux exposes only a file URI");
assert.match(view, /requestGalleryUpload\(\{/,
  "Gallery drops must open the shared topic/upload dialog even when the All filter is active");
assert.match(view, /initialThreadId: topic\?\.threadId/,
  "an active Gallery topic must be preselected without being required");

console.log("gallery_drop_upload_smoke: OK");
