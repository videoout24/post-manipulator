import { FORMAT_GROUPS } from "../core/FormattingRegistry.js?v=1.5.9";

const prop = (property, key, extra = {}) => ({ property, key, ...extra });
const rich = (property, key, formats = FORMAT_GROUPS.full, extra = {}) =>
  prop(property, key, { formats, ...extra });
const semantic = (type, name, properties, extra = {}) => ({
  type, name, category: "Семантика", semantic: { inline: true },
  accepts: { properties }, children: { allowed: false }, ...extra
});

export function registerTelegramCore(registry) {
  const blocks = [
    {
      type: "paragraph", name: "Paragraph", category: "Content",
      accepts: { properties: [rich("content.text", "text", FORMAT_GROUPS.full, { required: true })] },
      children: { allowed:false }
    },
    {
      type: "heading", name: "Heading", category: "Content",
      accepts: { properties: [
        rich("content.text", "text", FORMAT_GROUPS.full, { required: true, default: "Heading" }),
        prop("heading.size", "level")
      ] },
      children: { allowed:false }
    },
    {
      type: "preformatted", name: "Preformatted", category: "Content",
      accepts: { properties: [
        rich("content.text", "text", FORMAT_GROUPS.code, { label: "Code" }),
        prop("preformatted.language", "language")
      ] },
      children:{allowed:false}
    },
    {
      type: "footer", name: "Footer", category: "Content",
      accepts: { properties: [rich("content.text", "text", FORMAT_GROUPS.full)] },
      children:{allowed:false}
    },
    { type:"divider", name:"Divider", category:"Content", accepts:{properties:[]}, children:{allowed:false} },
    {
      type:"mathematical_expression", name:"Math", category:"Content",
      accepts:{properties:[prop("math.expression", "expression")]},
      children:{allowed:false}
    },
    {
      type:"anchor", name:"Anchor", category:"Навигация",
      accepts:{properties:[prop("anchor.name", "name", { required: true })]},
      children:{allowed:false}
    },

    // Parameterized RichText entities are represented as explicit Builder blocks.
    // If a Paragraph cursor is active, clicking these palette entries configures and
    // inserts the corresponding RichText entity directly at the caret.
    semantic("date_time", "Date / Time", [
      prop("semantic.dateTime", "dateTime", { required: true }),
      prop("semantic.dateTimeFormat", "dateTimeFormat")
    ]),
    semantic("phone", "Phone", [
      prop("semantic.text", "text", { default: "Позвонить" }),
      prop("contact.phone", "phoneNumber", { required: true })
    ]),
    semantic("email", "Email", [
      prop("semantic.text", "text", { default: "Написать" }),
      prop("contact.email", "email", { required: true })
    ]),
    semantic("hashtag", "Hashtag", [
      prop("hashtag.value", "hashtag", { required: true })
    ]),
    semantic("text_link", "Text Link", [
      prop("semantic.text", "text", { default: "Подробнее" }),
      prop("link.url", "url", { required: true })
    ]),
    semantic("anchor_link", "Ссылка на якорь", [
      prop("semantic.text", "text", { default: "Перейти" }),
      prop("anchor.target", "targetAnchorId")
    ], { category: "Навигация" }),
    {
      type: "url_button", name: "URL Button", category: "Семантика",
      wire: { kind: "reply_markup" },
      constraints: { allowedParents: ["document"] },
      accepts: { properties: [
        prop("semantic.text", "text", { default: "Открыть" }),
        prop("link.url", "url", { required: true }),
        prop("button.style", "buttonStyle")
      ] },
      children: { allowed: false }
    },

    {
      type:"list", name:"List", category:"Content",
      accepts:{properties:[
        prop("list.items", "items", { required:true, hint:"Каждый элемент управляется отдельно; в Checkbox-режиме checked задаётся для каждой строки независимо" })
      ]},
      children:{allowed:false}
    },
    {
      type:"block_quotation", name:"Цитаты", category:"Content",
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"expandable_block_quotation", name:"Сворачиваемая цитата", paletteHidden:true, category:"Content",
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"pull_quotation", name:"Pull quotation", paletteHidden:true, category:"Content",
      accepts:{properties:[
        rich("content.text", "text", FORMAT_GROUPS.full, { required:true }),
        rich("content.credit", "credit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"collage", name:"Collage", paletteLabel:"Collage / Slideshow", category:"Media", gallery:{acceptedTypes:["photo","video"],mode:"children"},
      accepts:{properties:[
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:true,types:["photo","video"],minItems:1}
    },
    {
      type:"slideshow", name:"Slideshow", paletteHidden:true, category:"Media", gallery:{acceptedTypes:["photo","video"],mode:"children"},
      accepts:{properties:[
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:true,types:["photo","video"],minItems:1}
    },
    {
      type:"table", name:"Table", category:"Content",
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
      type:"details", name:"Details", category:"Content",
      accepts:{properties:[
        rich("details.summary", "summary", FORMAT_GROUPS.full),
        prop("details.isOpen", "open")
      ]},
      children:{allowed:true}
    },
    {
      type:"map", name:"Map", category:"Media",
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
      type:"animation", name:"Animation", category:"Media",
      accepts:{properties:[
        prop("media.animation", "url", { required:true, mediaKind:"animation" }),
        prop("media.hasSpoiler", "hasSpoiler", { scope:"received/media" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"audio", name:"Audio", category:"Media", gallery:{acceptedTypes:["audio"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"audio" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"document", name:"Document", category:"Media", gallery:{acceptedTypes:["document"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"document" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"photo", name:"Photo", category:"Media", gallery:{acceptedTypes:["photo"]},
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
      type:"video", name:"Video", category:"Media", gallery:{acceptedTypes:["video"]},
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
      type:"voice_note", name:"Voice note", category:"Media", gallery:{acceptedTypes:["voice"]},
      accepts:{properties:[
        prop("media.galleryId", "galleryId"),
        prop("media.fileId", "fileId", { required:true, mediaKind:"voice_note" }),
        rich("content.caption", "caption", FORMAT_GROUPS.full),
        rich("content.captionCredit", "captionCredit", FORMAT_GROUPS.full)
      ]},
      children:{allowed:false}
    },
    {
      type:"thinking", name:"Thinking", category:"System",
      capabilities:{streaming:true,persistent:false},
      accepts:{properties:[rich("thinking.text", "text", FORMAT_GROUPS.full)]},
      children:{allowed:false}
    }
  ];

  for (const b of blocks) registry.register(b);
  return blocks.length;
}
