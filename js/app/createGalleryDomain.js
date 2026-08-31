import { GalleryStore } from "../gallery/GalleryStore.js?v=1.5.9";
import { ThumbnailCache } from "../gallery/ThumbnailCache.js?v=1.5.9";
import { GalleryCore } from "../gallery/GalleryCore.js?v=1.5.9";

export function createGalleryDomain({ db, events, telegramCore, client, projects = null, drafts = null, tree = null, projectSession = null, draftSession = null } = {}) {
  const store = new GalleryStore({ db, events });
  const thumbnails = new ThumbnailCache({ db, client, events });
  const core = new GalleryCore({
    db,
    events,
    telegramCore,
    client,
    store,
    thumbnails,
    projects,
    drafts,
    tree,
    projectSession,
    draftSession
  });
  return Object.freeze({ store, thumbnails, core });
}
