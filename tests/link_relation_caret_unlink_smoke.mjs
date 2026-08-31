import assert from "node:assert/strict";
import { EventBus } from "../js/core/EventBus.js";
import { LinkingController } from "../js/links/LinkingController.js";

// The ↗ control is a toggle for an existing internal link.  It must therefore
// be possible to unlink with a collapsed caret inside the marker: requiring a
// new text selection in that case makes the focused source impossible to
// remove without selecting it again.  A range that merely intersects a marker
// has the same unlink meaning.  A collapsed caret outside a marker remains an
// invalid request to create a relation.
await assertUnlinks({
  start: 5,
  end: 5,
  label: "a caret inside the relation marker"
});

await assertUnlinks({
  start: 2,
  end: 4,
  label: "a selection that intersects the relation marker"
});

await assertRejectsEmptyCaretOutsideRelation();

console.log("link_relation_caret_unlink_smoke: OK");

async function assertUnlinks({ start, end, label }) {
  const fixture = createFixture();
  const result = await fixture.linking.attachInline({
    nodeId: "source",
    property: "text",
    start,
    end
  });

  assert.deepEqual(result, { removed: "relation_1" }, `${label} must be accepted as unlink`);
  assert.equal(fixture.confirmations.length, 1, `${label} must ask before unlinking`);
  assert.equal(fixture.removeCalls(), 1, `${label} must remove the persistent relation`);
  assert.equal(fixture.nodes.get("source").props.text, "До ссылка после", `${label} must unwrap the source marker`);
  fixture.linking.stop();
}

async function assertRejectsEmptyCaretOutsideRelation() {
  const fixture = createFixture();
  await assert.rejects(
    () => fixture.linking.attachInline({
      nodeId: "source",
      property: "text",
      start: 0,
      end: 0
    }),
    /Выделите текст, который нужно связать/
  );

  assert.equal(fixture.confirmations.length, 0, "an empty caret outside a relation must not open unlink confirmation");
  assert.equal(fixture.removeCalls(), 0, "an empty caret outside a relation must not remove anything");
  assert.equal(fixture.nodes.get("source").props.text[1].type, "link_relation", "an empty caret outside a relation must preserve the marker");
  fixture.linking.stop();
}

function createFixture() {
  const events = new EventBus();
  const nodes = new Map([
    ["source", {
      id: "source",
      props: {
        text: [
          "До ",
          {
            type: "link_relation",
            relation_id: "relation_1",
            text: "ссылка",
            url: "rmb-link:relation_1",
            target_title: "Целевой черновик",
            target_kind: "draft"
          },
          " после"
        ]
      }
    }]
  ]);
  const rows = new Map([["relation_1", {
    id: "relation_1",
    source: {
      kind: "draft",
      id: "source_draft",
      nodeId: "source",
      property: "text",
      mode: "inline"
    },
    target: { kind: "draft", id: "target_draft", title: "Целевой черновик" },
    label: "ссылка"
  }]]);
  const confirmations = [];
  let removed = 0;
  const linking = new LinkingController({
    events,
    tree: { find: id => nodes.get(id) || null },
    controller: {
      updateNodeProperty(nodeId, property, value) {
        nodes.get(nodeId).props[property] = value;
      }
    },
    linkRelations: {
      async list() { return [...rows.values()].map(value => structuredClone(value)); },
      async get(id) { return structuredClone(rows.get(String(id)) || null); },
      async remove(id) {
        removed += 1;
        const relation = rows.get(String(id)) || null;
        rows.delete(String(id));
        return structuredClone(relation);
      }
    },
    confirmFn(message) {
      confirmations.push(message);
      return true;
    }
  }).start();

  return {
    linking,
    nodes,
    confirmations,
    removeCalls: () => removed
  };
}
