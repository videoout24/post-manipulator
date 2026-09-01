import { t } from "../i18n/index.js?v=1.8.0";
const BLOCK_TO_GALLERY = Object.freeze({
  photo: ["photo"],
  video: ["video"],
  audio: ["audio"],
  document: ["document"],
  voice_note: ["voice"],
  collage: ["photo", "video"],
  slideshow: ["photo", "video"]
});

const ASSET_TO_BLOCK = Object.freeze({
  photo: "photo",
  video: "video"
});

export class MediaAssetBinder {
  constructor({ tree, registry, controller, gallery, events = null } = {}) {
    this.tree = tree;
    this.registry = registry;
    this.controller = controller;
    this.gallery = gallery;
    this.events = events;
  }

  acceptedTypes(nodeOrType) {
    const type = typeof nodeOrType === "string" ? nodeOrType : nodeOrType?.type;
    const def = this.registry.get(type);
    const declared = def?.gallery?.acceptedTypes;
    return Array.isArray(declared) ? declared : (BLOCK_TO_GALLERY[type] || []);
  }

  mode(nodeOrType) {
    const type = typeof nodeOrType === "string" ? nodeOrType : nodeOrType?.type;
    return this.registry.get(type)?.gallery?.mode || "single";
  }

  isCollection(nodeOrType) { return this.mode(nodeOrType) === "children"; }
  supports(nodeOrType) { return this.acceptedTypes(nodeOrType).length > 0; }

  accepts(nodeOrType, assetType) {
    return this.acceptedTypes(nodeOrType).includes(assetType);
  }

  async assign(nodeId, assetOrId) {
    const node = this.tree.find(nodeId);
    if (!node) throw new Error(t("editor.mediaAssetBinder.mediaBlockNotFound"));
    const asset = typeof assetOrId === "string" ? await this.gallery.getAsset(assetOrId) : assetOrId;
    if (!asset) throw new Error(t("editor.mediaAssetBinder.galleryAssetNotFound"));
    if (!this.accepts(node, asset.type)) {
      throw new Error(t("editor.mediaAssetBinder.doesNotAcceptGalleryType", { 0: this.registry.get(node.type)?.name || node.type, 1: asset.type }));
    }
    const fileId = String(asset.telegram?.fileId || "").trim();
    if (!fileId) throw new Error(t("editor.mediaAssetBinder.galleryAssetIsMissingTelegramFileId"));

    const patch = makeAssetPatch(asset, fileId);
    if (this.isCollection(node)) {
      return this.#appendChild(node, asset, patch);
    }

    this.controller.updateNodeProperties(nodeId, patch, { inspectorSource: false });
    this.events?.emit?.("editor:media-asset-assigned", { nodeId, asset: structuredClone(asset), mode: "single" });
    return asset;
  }

  #appendChild(container, asset, patch) {
    const childType = ASSET_TO_BLOCK[asset.type];
    if (!childType) throw new Error(t("editor.mediaAssetBinder.cannotYetCreateRichBlockForGalleryType", { 0: container.type, 1: asset.type }));

    const collectionPatch = { ...patch };
    delete collectionPatch.caption;
    const child = this.controller.addBlock(childType, container.id, Infinity, {
      props: collectionPatch,
      select: false
    });
    if (!child) throw new Error(t("editor.mediaAssetBinder.failedToAddTo", { 0: asset.type, 1: container.type }));

    // Keep the collection selected so the left Gallery picker stays open for rapid multi-add.
    this.controller.select(container.id);
    this.events?.emit?.("editor:media-asset-assigned", {
      nodeId: child.id,
      containerId: container.id,
      asset: structuredClone(asset),
      mode: "children"
    });
    return asset;
  }
}

function makeAssetPatch(asset, fileId) {
  const patch = {
    galleryId: asset.id,
    fileId,
    // Compatibility with pre-Gallery documents/renderers/extensions.
    url: fileId
  };
  if (String(asset.caption || "").trim()) patch.caption = asset.caption;
  return patch;
}

export const MEDIA_GALLERY_TYPES = BLOCK_TO_GALLERY;
