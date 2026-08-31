export class ProjectIndex {
  constructor(project = null) {
    this.projectId = null;
    this.mapToHostPost = new Map();
    this.postToMapSlots = new Map();
    this.mapToBacklinks = new Map();
    this.postToMapDependents = new Map();
    this.postToBacklinkDependents = new Map();
    this.postToDependents = new Map();
    this.duplicates = [];
    if (project) this.rebuild(project);
  }

  rebuild(project) {
    this.projectId = project?.id || null;
    this.mapToHostPost.clear();
    this.postToMapSlots.clear();
    this.mapToBacklinks.clear();
    this.postToMapDependents.clear();
    this.postToBacklinkDependents.clear();
    this.postToDependents.clear();
    this.duplicates = [];

    const seenMaps = new Set();
    const seenSlots = new Set();

    for (const post of project?.posts || []) {
      walkAst(post.messageAst, node => {
        if (node.type === "project_post_map") {
          const mapId = stringOrEmpty(node.props?.mapId);
          if (mapId) {
            if (seenMaps.has(mapId)) this.duplicates.push({ kind: "mapId", id: mapId, postId: post.id });
            seenMaps.add(mapId);
            if (!this.mapToHostPost.has(mapId)) this.mapToHostPost.set(mapId, post.id);
          }

          for (const slot of Array.isArray(node.props?.slots) ? node.props.slots : []) {
            const slotId = stringOrEmpty(slot?.id);
            if (slotId) {
              if (seenSlots.has(slotId)) this.duplicates.push({ kind: "slotId", id: slotId, postId: post.id });
              seenSlots.add(slotId);
            }
            const targetPostId = stringOrEmpty(slot?.targetPostId);
            if (!targetPostId) continue;
            pushMapList(this.postToMapSlots, targetPostId, {
              hostPostId: post.id,
              mapId: mapId || null,
              slotId: slotId || null
            });
            // Map rendering depends on target post state/Heading and on the target
            // deployment identity used for the link.
            pushSet(this.postToMapDependents, targetPostId, post.id);
            pushSet(this.postToDependents, targetPostId, post.id);
          }
        }

        if (node.type === "project_map_backlink") {
          const targetMapId = stringOrEmpty(node.props?.targetMapId);
          if (!targetMapId) return;
          pushMapList(this.mapToBacklinks, targetMapId, { hostPostId: post.id, nodeId: node.id || null, slotId: stringOrEmpty(node.props?.targetSlotId) || null });
        }
      });
    }

    for (const [mapId, backlinks] of this.mapToBacklinks) {
      const mapHostPostId = this.mapToHostPost.get(mapId);
      if (!mapHostPostId) continue;
      for (const backlink of backlinks) {
        // Backlink text depends on the map host deployment identity, not on arbitrary
        // content edits inside that host post.
        pushSet(this.postToBacklinkDependents, mapHostPostId, backlink.hostPostId);
        pushSet(this.postToDependents, mapHostPostId, backlink.hostPostId);
      }
    }

    return this;
  }

  hostPostForMap(mapId) { return this.mapToHostPost.get(mapId) || null; }
  mapSlotsForPost(postId) { return structuredClone(this.postToMapSlots.get(postId) || []); }
  backlinksForMap(mapId) { return structuredClone(this.mapToBacklinks.get(mapId) || []); }
  dependentsForPost(postId) { return [...(this.postToDependents.get(postId) || new Set())]; }
  mapDependentsForPost(postId) { return [...(this.postToMapDependents.get(postId) || new Set())]; }
  backlinkDependentsForPost(postId) { return [...(this.postToBacklinkDependents.get(postId) || new Set())]; }

  // Normal content edits propagate through Map slots only. Backlinks are deliberately
  // excluded here; they need an edit only when the referenced map-host message_id changes.
  contentClosure(postIds = []) {
    const queue = [...new Set((postIds || []).filter(Boolean).map(String))];
    const seen = new Set(queue);
    while (queue.length) {
      const postId = queue.shift();
      for (const dependentId of this.postToMapDependents.get(postId) || []) {
        if (seen.has(dependentId)) continue;
        seen.add(dependentId);
        queue.push(dependentId);
      }
    }
    return [...seen];
  }

  // If a Telegram message identity changes, every compiled link that references it must
  // be refreshed: Map slots pointing to the post and Backlinks pointing to Maps hosted by it.
  identityDependentsForPost(postId) {
    return [...new Set([
      ...(this.postToMapDependents.get(postId) || new Set()),
      ...(this.postToBacklinkDependents.get(postId) || new Set())
    ])];
  }

  dependencyClosure(postIds = []) { return this.contentClosure(postIds); }

  snapshot() {
    return {
      projectId: this.projectId,
      mapToHostPost: Object.fromEntries(this.mapToHostPost),
      postToMapSlots: Object.fromEntries([...this.postToMapSlots].map(([key, value]) => [key, structuredClone(value)])),
      mapToBacklinks: Object.fromEntries([...this.mapToBacklinks].map(([key, value]) => [key, structuredClone(value)])),
      postToMapDependents: Object.fromEntries([...this.postToMapDependents].map(([key, value]) => [key, [...value]])),
      postToBacklinkDependents: Object.fromEntries([...this.postToBacklinkDependents].map(([key, value]) => [key, [...value]])),
      postToDependents: Object.fromEntries([...this.postToDependents].map(([key, value]) => [key, [...value]])),
      duplicates: structuredClone(this.duplicates)
    };
  }
}

function walkAst(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.children || []) walkAst(child, fn);
}

function pushMapList(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function pushSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function stringOrEmpty(value) {
  return value == null ? "" : String(value).trim();
}
