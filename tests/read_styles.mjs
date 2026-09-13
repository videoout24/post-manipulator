import fs from "node:fs";
import { readFile } from "node:fs/promises";

const ENTRY_URL = new URL("../style.css", import.meta.url);
const IMPORT_PATTERN = /@import\s+url\((?:"([^"]+)"|'([^']+)'|([^\s)]+))\)\s*;/g;

function importedStyleUrls(entry) {
  return [...entry.matchAll(IMPORT_PATTERN)].map((match) => {
    const url = new URL(match[1] || match[2] || match[3], ENTRY_URL);
    url.search = "";
    url.hash = "";
    return url;
  });
}

export function readStylesSync() {
  const entry = fs.readFileSync(ENTRY_URL, "utf8");
  return importedStyleUrls(entry)
    .map((url) => fs.readFileSync(url, "utf8"))
    .join("");
}

export async function readStyles() {
  const entry = await readFile(ENTRY_URL, "utf8");
  const chunks = await Promise.all(
    importedStyleUrls(entry).map((url) => readFile(url, "utf8"))
  );
  return chunks.join("");
}
