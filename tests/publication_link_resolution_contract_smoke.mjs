import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const domain = await readFile(new URL("../js/app/createTelegramDomain.js", import.meta.url), "utf8");
const publications = await readFile(new URL("../js/telegram/PublicationService.js", import.meta.url), "utf8");
assert.match(domain, /new LinkRelationStore/);
assert.match(domain, /linkRelations/);
assert.match(publications, /resolveWaitingForPublication/);
assert.match(publications, /materializeAst/);
assert.match(publications, /#applyResolvedRelations/);
assert.match(publications, /markApplied/);
console.log("publication_link_resolution_contract_smoke: OK");
