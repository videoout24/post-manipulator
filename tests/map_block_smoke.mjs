import assert from "node:assert/strict";
import { BlockRegistry } from "../js/core/BlockRegistry.js?v=1.5.9";
import { BlockTree } from "../js/core/BlockTree.js?v=1.5.9";
import { createTelegramFormattingRegistry } from "../js/core/FormattingRegistry.js?v=1.5.9";
import { createDefaultPropertyRegistry } from "../js/core/PropertyRegistry.js?v=1.11.4";
import { Validator } from "../js/core/Validator.js?v=1.11.4";
import { registerTelegramCore } from "../js/blocks/registerCoreBlocks.js?v=1.11.4";
import { TelegramRenderer } from "../js/telegram/TelegramRenderer.js?v=1.11.4";

const registry = new BlockRegistry(createDefaultPropertyRegistry(createTelegramFormattingRegistry()));
registerTelegramCore(registry);
const definition = registry.get("map");
const bindings = registry.propertyBindings(definition);
assert.deepEqual(
  bindings.map(binding => binding.key),
  ["location", "mapUrl", "zoom", "orientation", "caption", "captionCredit"]
);
assert.equal(bindings.find(binding => binding.key === "zoom").min, 1);
assert.equal(bindings.find(binding => binding.key === "zoom").max, 20);
assert.equal(bindings.some(binding => ["width", "height"].includes(binding.key)), false);

const map = {
  id: "map",
  type: "map",
  props: {
    mapUrl: "https://maps.apple.com/frame?center=40.753035,-73.981846",
    location: { latitude: 0, longitude: 0, horizontal_accuracy: 100 },
    zoom: 20,
    orientation: "portrait"
  },
  children: []
};
const tree = new BlockTree({ id: "root", type: "document", props: {}, children: [map] });
assert.deepEqual(new Validator(registry).validate(tree), []);
assert.deepEqual(new TelegramRenderer(registry).render(tree).blocks[0], {
  type: "map",
  location: { latitude: 40.753035, longitude: -73.981846 },
  zoom: 20,
  width: 320,
  height: 640
});

map.props.orientation = "landscape";
map.props.zoom = 0;
const landscape = new TelegramRenderer(registry).render(tree).blocks[0];
assert.equal(landscape.zoom, 1);
assert.equal(landscape.width, 640);
assert.equal(landscape.height, 320);

map.props.mapUrl = "https://maps.app.goo.gl/example";
assert.match(new Validator(registry).validate(tree).join("\n"), /must contain latitude and longitude/);

console.log("map_block_smoke: OK");
