import { t } from "../i18n/index.js?v=1.8.2";
import { FORMAT_GROUPS } from "../core/FormattingRegistry.js?v=1.7.9";

const prop = (property, key, extra = {}) => ({ property, key, ...extra });
const rich = (property, key, formats = FORMAT_GROUPS.full, extra = {}) =>
  prop(property, key, { formats, ...extra });
const semantic = (type, name, properties, extra = {}) => ({
  type, name, category: t("blocks.registerCoreBlocks.semantics"), semantic: { inline: true },
  accepts: { properties }, children: { allowed: false }, ...extra
});

export function registerTelegramCore(registry) {
  const blocks = [
    {
      type: "paragraph", name: t("blocks.registerCoreBlocks.paragraph"), category: t("blocks.category.content"),
      accepts: { properties: [rich("content.text", "text", FORMAT_GROUPS.full, { required: true })] },
      children: { allowed:false }
    },
    {
      type: "heading", name: t("blocks.registerCoreBlocks.heading"), category: t("blocks.category.content"),
      accepts: { properties: [
        rich("content.text", "text", FORMAT_GROUPS.full, { required: true, default: t("blocks.registerCoreBlocks.heading") }),
        prop("heading.size", "level")
      ] },
      children: { allowed:false }
    },
    {
      type: "preformatted", name: t("blocks.registerCoreBlocks.preformatted"), category: t("blocks.category.content"),
      accepts: { properties: [
        rich("content.text", "text", FORMAT_GROUPS.code, { label: t("blocks.registerCoreBlocks.code") }),
        prop("preformatted.language", "language")
      ] },
      children:{allowed:false}
    },
    {
      type: "footer", name: t("blocks.registerCoreBlocks.footer"), category: t("blocks.category.content"),
      accepts: { properties: [rich("content.text", "text", FORMAT_GROUPS.full)] },
      children:{allowed:false}
    },
    { type:"divider", name:t("blocks.registerCoreBlocks.divider"), category:t("blocks.category.content"), accepts:{properties:[]}, children:{allowed:false} },
    {
      type:"mathematical_expression", name:t("blocks.registerCoreBlocks.math"), category:t("blocks.category.content"),
      accepts:{properties:[prop("math.expression", "expression")]},
      children:{allowed:false}
    },
    {
      type:"anchor", name:t("blocks.registerCoreBlocks.anchor"), category:t("blocks.registerCoreBlocks.navigation"),
      accepts:{properties:[prop("anchor.name", "name", { required: true })]},
      children:{allowed:false}
    },

    // Parameterized RichText entities are represented as explicit Builder blocks.
    // If a Paragraph cursor is active, clicking these palette entries configures and
    // inserts the corresponding RichText entity directly at the caret.
    semantic("date_time", t("blocks.registerCoreBlocks.dateTime"), [
      prop("semantic.dateTime", "dateTime", { required: true }),
      prop("semantic.dateTimeFormat", "dateTimeFormat")
    ]),
    semantic("phone", t("blocks.registerCoreBlocks.phone"), [
      prop("semantic.text", "text", { default: t("blocks.registerCoreBlocks.call") }),
      prop("contact.phone", "phoneNumber", { required: true })
    ]),
    semantic("email", t("blocks.registerCoreBlocks.email"), [
      prop("semantic.text", "text", { default: t("blocks.registerCoreBlocks.write") }),
      prop("contact.email", "email", { required: true })
    ]),
    semantic("hashtag", t("blocks.registerCoreBlocks.hashtag"), [
      prop("hashtag.value", "hashtag", { required: true })
    ]),
    semantic("text_link", t("blocks.registerCoreBlocks.textLink"), [
      prop("semantic.text", "text", { default: t("blocks.registerCoreBlocks.more") }),
      prop("link.url", "url", { required: true })
    ]),
    semantic("anchor_link", t("blocks.registerCoreBlocks.anchorLink"), [
      prop("semantic.text", "text", { default: t("blocks.registerCoreBlocks.go") }),
      prop("anchor.target", "targetAnchorId")
    ], { category: t("blocks.registerCoreBlocks.navigation") }),
    {
      type: "button_row", name: t("blocks.registerCoreBlocks.buttonRow"), category: t("blocks.registerCoreBlocks.semantics"),
      wire: { kind: "rich_block", type: "buttons" },
      constraints: { allowedParents: ["document"] },
      accepts: { properties: [prop("button.align", "buttonAlign")] },
      children: { allowed: true, types: ["url_button"], minItems: 1, maxItems: 8 }
    },
    {
      type: "url_button", name: t("blocks.registerCoreBlocks.urlButton"), category: t("blocks.registerCoreBlocks.semantics"),
      wire: { kind: "rich_button" },
      constraints: { allowedParents: ["document", "button_row"] },
      accepts: { properties: [
        prop("semantic.text", "text", { default: t("blocks.registerCoreBlocks.open") }),
        prop("link.url", "url", { required: true }),
        prop("button.style", "buttonStyle")
      ] },
      children: { allowed: false }
    },

    {
      type:"list", name:t("blocks.registerCoreBlocks.list"), category:t("blocks.category.content"),
      accepts:{properties:[
        prop("list.items", "items", { required:true, hint:t("blocks.registerCoreBlocks.eachItemIsManagedSeparatelyInCheckbox") })
      ]},
      children:{allowed:false}
    },
    {
      type:"block_quotation", name:t("blocks.registerCoreBlocks.quotes"), category:t("blocks.category.content"),
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"expandable_block_quotation", name:t("blocks.registerCoreBlocks.collapsibleQuote"), paletteHidden:true, category:t("blocks.category.content"),
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"pull_quotation", name:t("blocks.registerCoreBlocks.pullQuotation"), paletteHidden:true, category:t("blocks.category.content"),
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"collage", name:t("blocks.registerCoreBlocks.collage"), paletteLabel:t("blocks.registerCoreBlocks.collageSlideshow"), category:t("blocks.category.media"), gallery:{acceptedTypes:["photo","video"],mode:"children"},
      accepts:{properties:[
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:true,types:["photo","video"],minItems:1}
    },
    {
      type:"slideshow", name:t("blocks.registerCoreBlocks.slideshow"), paletteHidden:true, category:t("blocks.category.media"), gallery:{acceptedTypes:["photo","video"],mode:"children"},
      accepts:{properties:[
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:true,types:["photo","video"],minItems:1}
    },
    {
      type:"table", name:t("blocks.registerCoreBlocks.table"), category:t("blocks.category.content"),
      accepts:{properties:[
        prop("table.cells", "cells", { required:true }),
        prop("table.isBordered", "isBordered"),
        prop("table.isStriped", "isStriped"),
        prop("table.isCompact", "isCompact"),
        rich("content.caption", "caption", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"details", name:t("blocks.registerCoreBlocks.details"), category:t("blocks.category.content"),
      accepts:{properties:[
        rich("details.summary", "summary", FORMAT_GROUPS.full),
        prop("details.isOpen", "open")
      ]},
      children:{allowed:true}
    },
    {
      type:"map", name:t("blocks.registerCoreBlocks.map"), category:t("blocks.category.media"),
      accepts:{properties:[
        prop("map.location", "location"),
        prop("map.zoom", "zoom"),
        prop("map.width", "width"),
        prop("map.height", "height"),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"animation", name:t("blocks.registerCoreBlocks.animation"), category:t("blocks.category.media"),
      accepts:{properties:[
        prop("media.animation", "url", { required:true, mediaKind:"animation" }),
        prop("media.hasSpoiler", "hasSpoiler", { scope:"received/media" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"audio", name:t("blocks.registerCoreBlocks.audio"), category:t("blocks.category.media"), gallery:{acceptedTypes:["audio"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"audio" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"document", name:t("blocks.registerCoreBlocks.document"), category:t("blocks.category.media"), gallery:{acceptedTypes:["document"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"document" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"photo", name:t("blocks.registerCoreBlocks.photo"), category:t("blocks.category.media"), gallery:{acceptedTypes:["photo"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"photo" }),
        prop("media.hasSpoiler", "hasSpoiler", { scope:"received/media" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"video", name:t("blocks.registerCoreBlocks.video"), category:t("blocks.category.media"), gallery:{acceptedTypes:["video"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"video" }),
        prop("media.hasSpoiler", "hasSpoiler", { scope:"received/media" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"voice_note", name:t("blocks.registerCoreBlocks.voiceNote"), category:t("blocks.category.media"), gallery:{acceptedTypes:["voice"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"voice_note" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"thinking", name:t("blocks.registerCoreBlocks.thinking"), paletteHidden:true, category:t("blocks.category.system"),
      capabilities:{streaming:true,persistent:false},
      accepts:{properties:[rich("thinking.text", "text", FORMAT_GROUPS.full)]},
      children:{allowed:false}
    }
  ];

  for (const b of blocks) registry.register(b);
  return blocks.length;
}
