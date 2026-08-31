import assert from "node:assert/strict";
import { findLinkRelationAtRange, findLinkRelationById, materializeRelationUrl, removeLinkRelationFromAst, renderableRichText } from "../js/links/LinkRelationAst.js?v=1.5.9";

const ast = { children: [{ props: { text: ["Читайте ", { type: "link_relation", relation_id: "link_1", text: "продолжение" }] } }] };
const resolved = materializeRelationUrl(ast, "link_1", "https://t.me/c/1/2");
const marker = resolved.children[0].props.text[1];
assert.equal(marker.url, "https://t.me/c/1/2");
assert.deepEqual(renderableRichText(marker), { type: "url", text: "продолжение", url: "https://t.me/c/1/2" });
assert.equal(renderableRichText({ type: "link_relation", relation_id: "link_2", text: "ожидается" }), "ожидается");
assert.equal(findLinkRelationAtRange(resolved.children[0].props.text, 7, 18)?.relationId, "link_1");
assert.deepEqual(findLinkRelationById(resolved.children[0].props.text, "link_1"), {
  relationId: "link_1",
  value: marker,
  start: 8,
  end: 19
});
const removed = removeLinkRelationFromAst(resolved, "link_1");
assert.equal(removed.children[0].props.text, "Читайте продолжение");
console.log("link_relation_ast_smoke: OK");
