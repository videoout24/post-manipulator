import { richTextToPlain } from "./RichText.js?v=1.5.9";
import { normalizeStoredMediaSource } from "./MediaSource.js?v=1.11.4";
import { mapDimensions, mapOrientation, normalizeMapZoom, resolveMapLink } from "./MapLinkResolver.js?v=1.11.4";

export function migrateDocumentTree(tree) {
  migrateLegacyMediaProps(tree);
  migrateLegacyMapProps(tree);
  migrateLegacyListAndQuotes(tree);
  return tree;
}

export function migrateLegacyMapProps(tree) {
  tree?.walk?.(node => {
    if (node.type !== "map") return;
    node.props ||= {};
    const orientation = mapOrientation(node.props);
    const dimensions = mapDimensions(orientation);
    node.props.orientation = orientation;
    node.props.width = dimensions.width;
    node.props.height = dimensions.height;
    node.props.zoom = normalizeMapZoom(node.props.zoom);

    if (String(node.props.mapUrl || "").trim()) {
      try {
        const resolved = resolveMapLink(node.props.mapUrl);
        node.props.location = resolved.location;
        if (resolved.zoom != null) node.props.zoom = resolved.zoom;
      } catch { /* Keep imported coordinates; validation will explain an invalid link. */ }
      return;
    }

    const location = node.props.location && typeof node.props.location === "object" ? node.props.location : {};
    const latitude = Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : Number(node.props.latitude || 0);
    const longitude = Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : Number(node.props.longitude || 0);
    node.props.location = { latitude, longitude };
    node.props.mapUrl = `geo:${latitude},${longitude}?z=${node.props.zoom}`;
  });
}

export function migrateLegacyMediaProps(tree) {
  tree?.walk?.(node => {
    normalizeStoredMediaSource(node);
  });
}

export function migrateLegacyListAndQuotes(tree) {
  tree?.walk?.(node => {
    node.props ||= {};

    if (node.type === "list") {
      let items = Array.isArray(node.props.items) ? node.props.items : [];
      if (!items.length && Array.isArray(node.children) && node.children.length) {
        items = node.children.map(child => ({ blocks: [plainParagraphFromNode(child)] }));
        node.children = [];
      }
      if (node.props.ordered) {
        items = items.map((item, index) => ({ ...item, type: item?.type || "1", value: item?.value ?? index + 1 }));
      }
      node.props.items = items;
      delete node.props.ordered;
    }

    if (node.type === "block_quotation" && Array.isArray(node.children) && node.children.length) {
      if (!richTextToPlain(node.props.text || "").trim()) {
        node.props.text = node.children
          .map(child => richTextToPlain(child?.props?.text ?? child?.props?.caption ?? ""))
          .filter(Boolean)
          .join("\n");
      }
      node.children = [];
    }
  });
}

function plainParagraphFromNode(node) {
  const text = richTextToPlain(node?.props?.text ?? node?.props?.caption ?? "");
  return { type: "paragraph", text };
}
