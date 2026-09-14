import assert from "node:assert/strict";
import { publicationMatchesSearch } from "../js/publications/PublicationView.js";

const draftPublication = { source: { kind: "draft", title: "Черновик про осень" } };
const projectPublication = {
  source: { kind: "project", title: "Первый пост", projectTitle: "Большой проект" }
};

assert.equal(publicationMatchesSearch(draftPublication, "черновик"), true);
assert.equal(publicationMatchesSearch(draftPublication, "ОСЕНЬ"), true);
assert.equal(publicationMatchesSearch(projectPublication, "первый"), true);
assert.equal(publicationMatchesSearch(projectPublication, "второй"), false);
assert.equal(publicationMatchesSearch(projectPublication, ""), true);

console.log("publication search smoke: OK");
