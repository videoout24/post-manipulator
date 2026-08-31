import { richTextToPlain } from "./RichText.js?v=1.5.9";

export function migrateDocumentTree(tree) {
  migrateLegacyMediaProps(tree);
  migrateLegacyListAndQuotes(tree);
  return tree;
}

export function migrateLegacyMediaProps(tree) {
  const mediaTypes = new Set(["photo", "video", "audio", "voice_note"]);
  tree?.walk?.(node => {
    if (!mediaTypes.has(node.type)) return;
    node.props ||= {};
    if (!node.props.fileId && node.props.url) node.props.fileId = node.props.url;
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
