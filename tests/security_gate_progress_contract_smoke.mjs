import assert from "node:assert/strict";
import fs from "node:fs";

const view = fs.readFileSync(new URL("../js/security/SecurityGateView.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

assert.match(view, /onUnlock: \["PROCESSING_PASSWORD"/);
assert.match(view, /onFirstToken: \["PROCESSING_TOKEN"/);
assert.match(view, /if \(progress\) this\.show\(progress\[0\], \{ message: progress\[1\] \}\)/);
assert.match(view, /aria-busy/);
assert.match(view, /role", "status"/);
assert.match(css, /\.security-gate-spinner \{/);
assert.match(css, /@keyframes security-gate-spin/);

console.log("security_gate_progress_contract_smoke: OK");
