import assert from "node:assert/strict";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { migrateLegacyMediaProps } from "../js/core/DocumentMigrations.js?v=1.11.2";
import {
  hasSeparateInternalMediaSource,
  normalizeMediaSourcePatch,
  supportsExternalMediaUrl
} from "../js/core/MediaSource.js?v=1.11.2";
import { EditorController } from "../js/editor/EditorController.js?v=1.11.2";
import { MediaAssetBinder } from "../js/editor/MediaAssetBinder.js?v=1.11.2";
import { isGalleryMediaSourceGroupLocked } from "../js/editor/BlockInspector.js?v=1.11.2";

const mediaTypes = ["animation", "audio", "document", "photo", "video", "voice_note"];
assert(mediaTypes.every(supportsExternalMediaUrl));
assert.equal(hasSeparateInternalMediaSource("animation"), false);
assert(mediaTypes.slice(1).every(hasSeparateInternalMediaSource));

const sourceBindings = [
  { property: "media.galleryId" },
  { property: "media.fileId" },
  { property: "media.remoteUrl" }
];
assert.equal(isGalleryMediaSourceGroupLocked({ props: { galleryId: "gallery-file" } }, sourceBindings), true);
assert.equal(isGalleryMediaSourceGroupLocked({ props: { galleryId: "" } }, sourceBindings), false);
assert.equal(
  isGalleryMediaSourceGroupLocked({ props: { galleryId: "gallery-file" } }, [{ property: "content.caption" }]),
  false,
  "a Gallery file only locks the group that exposes the external source"
);

const photo = {
  id: "photo",
  type: "photo",
  props: { galleryId: "gallery-old", fileId: "telegram-old", url: "" },
  children: []
};
const tree = new BlockTree({ id: "root", type: "document", props: {}, children: [photo] });
const controller = new EditorController({
  tree,
  registry: { get: () => ({ properties: {}, gallery: { acceptedTypes: ["photo"] } }) },
  validator: null,
  events: { emit() {} },
  selection: { primary: () => "photo" }
});

controller.updateNodeProperty("photo", "url", "https://cdn.example.com/photo.jpg");
assert.deepEqual(photo.props, {
  galleryId: "",
  fileId: "",
  url: "https://cdn.example.com/photo.jpg"
}, "entering an external URL clears both internal source identifiers");

controller.updateNodeProperties("photo", { galleryId: "gallery-next", fileId: "telegram-next" });
assert.deepEqual(photo.props, {
  galleryId: "gallery-next",
  fileId: "telegram-next",
  url: ""
}, "assigning an internal source clears the external URL");

controller.updateNodeProperty("photo", "url", "https://cdn.example.com/replaced.jpg");
const binder = new MediaAssetBinder({
  tree,
  registry: { get: () => ({ name: "Photo", gallery: { acceptedTypes: ["photo"] } }) },
  controller,
  gallery: null
});
await binder.assign("photo", {
  id: "gallery-picked",
  type: "photo",
  caption: "",
  telegram: { fileId: "telegram-picked" }
});
assert.deepEqual(photo.props, {
  galleryId: "gallery-picked",
  fileId: "telegram-picked",
  url: ""
}, "the Gallery picker replaces an external source instead of keeping both");

assert.deepEqual(
  normalizeMediaSourcePatch(photo, { url: "https://cdn.example.com/final.jpg", fileId: "stale" }),
  { url: "https://cdn.example.com/final.jpg", fileId: "", galleryId: "" },
  "an explicit external URL wins an ambiguous bulk patch"
);

const legacyTree = new BlockTree({
  id: "root",
  type: "document",
  props: {},
  children: [
    { id: "legacy-url", type: "video", props: { fileId: "https://cdn.example.com/video.mp4", galleryId: "old" }, children: [] },
    { id: "legacy-id", type: "document", props: { url: "telegram-document-id" }, children: [] },
    { id: "legacy-conflict", type: "audio", props: { url: "https://cdn.example.com/audio.mp3", fileId: "stale", galleryId: "stale" }, children: [] }
  ]
});
migrateLegacyMediaProps(legacyTree);
assert.deepEqual(legacyTree.find("legacy-url").props, {
  fileId: "",
  galleryId: "",
  url: "https://cdn.example.com/video.mp4"
});
assert.deepEqual(legacyTree.find("legacy-id").props, {
  url: "",
  fileId: "telegram-document-id"
});
assert.deepEqual(legacyTree.find("legacy-conflict").props, {
  url: "https://cdn.example.com/audio.mp3",
  fileId: "",
  galleryId: ""
});

console.log("media_source_exclusivity_smoke: OK");
