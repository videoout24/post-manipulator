import assert from "node:assert/strict";
import { projectGraphInputFingerprint } from "../js/project/ProjectGraphInputs.js?v=1.5.9";

const ast = children => ({ id: "root", type: "document", props: {}, children });
const heading = text => ({ id: "heading", type: "heading", props: { text }, children: [] });
const paragraph = text => ({ id: "paragraph", type: "paragraph", props: { text }, children: [] });
const map = targetPostId => ({
  id: "map", type: "project_post_map",
  props: { mapId: "map-1", numbering: "numeric", slots: [{ id: "slot-1", text: "derived", targetPostId }] },
  children: []
});

const baseline = ast([heading("Title"), paragraph("one"), map("post-2")]);
assert.equal(
  projectGraphInputFingerprint(baseline),
  projectGraphInputFingerprint(ast([heading("Title"), paragraph("changed"), map("post-2")])),
  "Ordinary content must not affect the graph fingerprint"
);
assert.equal(
  projectGraphInputFingerprint(baseline),
  projectGraphInputFingerprint(ast([heading("Title"), paragraph("one"), { ...map("post-2"), props: { ...map("post-2").props, numbering: "none", slots: [{ id: "slot-1", text: "new derived", targetPostId: "post-2" }] } }])),
  "Map presentation and derived text must not affect the graph fingerprint"
);
assert.notEqual(projectGraphInputFingerprint(baseline), projectGraphInputFingerprint(ast([heading("New title"), paragraph("one"), map("post-2")])));
assert.notEqual(projectGraphInputFingerprint(baseline), projectGraphInputFingerprint(ast([heading("Title"), paragraph("one"), map("post-3")])));
assert.notEqual(
  projectGraphInputFingerprint(baseline),
  projectGraphInputFingerprint(ast([heading("Title"), paragraph("one"), map("post-2"), {
    id: "back", type: "project_map_backlink", props: { targetMapId: "map-1", managedByMap: false }, children: []
  }]))
);

console.log("project_graph_input_fingerprint_smoke: OK");
