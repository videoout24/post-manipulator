const prop = (property, key, extra = {}) => ({ property, key, ...extra });

export function registerProjectBlocks(registry) {
  const blocks = [
    {
      type: "project_post_map",
      name: "Post Map",
      paletteLabel: "Post Map",
      category: "Project",
      projectVirtual: true,
      accepts: { properties: [
        prop("project.map.id", "mapId"),
        prop("project.map.slots", "slots"),
        prop("project.map.numbering", "numbering"),
        prop("project.map.prefix", "prefix"),
        prop("project.map.separator", "separator"),
        prop("project.map.emptyText", "emptyText")
      ] },
      children: { allowed: false },
      cloneIdentity: {
        ids: [{ property: "mapId", kind: "project-map" }],
        collectionIds: [{ property: "slots", idKey: "id", kind: "project-slot" }]
      }
    },
    {
      type: "project_map_backlink",
      name: "Back to Map",
      paletteLabel: "Back to Map",
      category: "Project",
      projectVirtual: true,
      accepts: { properties: [
        prop("project.backlink.relation", "targetMapId"),
        prop("project.backlink.text", "text")
      ] },
      children: { allowed: false },
      cloneIdentity: {
        references: [
          { property: "targetMapId", kind: "project-map" },
          { property: "targetSlotId", kind: "project-slot" }
        ]
      }
    }
  ];

  for (const block of blocks) registry.register(block);
  return blocks.length;
}
