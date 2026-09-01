import { t } from "../i18n/index.js?v=1.8.0";
const prop = (property, key, extra = {}) => ({ property, key, ...extra });

export function registerProjectBlocks(registry) {
  const blocks = [
    {
      type: "project_post_map",
      name: t("blocks.registerProjectBlocks.postMap"),
      paletteLabel: t("blocks.registerProjectBlocks.postMap"),
      category: t("blocks.category.project"),
      projectVirtual: true,
      accepts: { properties: [
        prop("project.map.id", "mapId"),
        prop("project.map.slots", "slots"),
        prop("project.map.numbering", "numbering"),
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
      name: t("blocks.registerProjectBlocks.backToMap"),
      paletteLabel: t("blocks.registerProjectBlocks.backToMap"),
      category: t("blocks.category.project"),
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
