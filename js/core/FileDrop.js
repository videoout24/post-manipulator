const LINUX_FILE_TRANSFER_TYPES = new Set([
  "application/x-moz-file",
  "text/uri-list"
]);

export function dataTransferMayContainFiles(dataTransfer) {
  if (!dataTransfer) return false;
  if (arrayFrom(dataTransfer.files).length) return true;
  if (arrayFrom(dataTransfer.items).some(itemMayContainFile)) return true;
  return arrayFrom(dataTransfer.types).some(type => {
    const normalized = String(type || "").toLowerCase();
    return normalized === "files" || LINUX_FILE_TRANSFER_TYPES.has(normalized);
  });
}

export function filesFromDataTransfer(dataTransfer) {
  const files = arrayFrom(dataTransfer?.files).filter(Boolean);
  if (files.length) return files;
  return arrayFrom(dataTransfer?.items)
    .filter(itemMayContainFile)
    .map(item => {
      try {
        return item.getAsFile?.() || null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function resolveFilesFromDataTransfer(dataTransfer) {
  const immediate = filesFromDataTransfer(dataTransfer);
  if (immediate.length) return immediate;
  // Capture asynchronous handles before the drop event leaves its readable
  // state. One rejected provider must not hide files from another item.
  const pending = [
    ...asyncFilesFromDataTransfer(dataTransfer),
    ...uriFilesFromDataTransfer(dataTransfer)
  ];
  if (!pending.length) return [];
  const settled = await Promise.allSettled(pending);
  return uniqueFiles(settled
    .filter(result => result.status === "fulfilled" && result.value)
    .flatMap(result => Array.isArray(result.value) ? result.value : [result.value]));
}

export async function resolveFilesForDrop(dataTransfer) {
  const files = await resolveFilesFromDataTransfer(dataTransfer);
  // Linux Telegram Desktop can advertise Files/text/uri-list while intentionally
  // withholding file bytes. A drop event does not reliably grant transient user
  // activation, so the caller must keep a visible file-picker button available
  // even if it also attempts to open the picker immediately.
  return {
    files,
    source: files.length ? "transfer" : "unavailable",
    pickerRequired: files.length === 0
  };
}

export function isBlobLike(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  const tag = Object.prototype.toString.call(value);
  return (tag === "[object Blob]" || tag === "[object File]")
    && Number.isFinite(Number(value.size))
    // Older Linux WebKit File wrappers predate Blob.arrayBuffer(), but are
    // still valid native Blob values for FormData. Requiring arrayBuffer made
    // a successful desktop drop look empty and opened the picker again.
    && ["arrayBuffer", "slice", "stream", "text"].some(method => typeof value[method] === "function");
}

function arrayFrom(value) {
  try {
    return Array.from(value || []);
  } catch {
    return [];
  }
}

function asyncFilesFromDataTransfer(dataTransfer) {
  const pending = [];
  for (const item of arrayFrom(dataTransfer?.items)) {
    if (!itemMayContainFile(item)) continue;
    try {
      if (typeof item.getAsFileSystemHandle === "function") {
        const handle = item.getAsFileSystemHandle();
        pending.push(Promise.resolve(handle).then(value => value?.kind === "file" ? value.getFile() : null));
      }
    } catch {}
    try {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isFile && typeof entry.file === "function") {
        pending.push(new Promise(resolve => entry.file(resolve, () => resolve(null))));
      }
    } catch {}
  }
  return pending;
}

function itemMayContainFile(item) {
  const kind = String(item?.kind || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  return kind === "file" || LINUX_FILE_TRANSFER_TYPES.has(type);
}

function uriFilesFromDataTransfer(dataTransfer) {
  const pending = [];
  const direct = readTransferText(dataTransfer, "text/uri-list");
  if (direct) return filePromisesFromUriList(direct);

  for (const item of arrayFrom(dataTransfer?.items)) {
    if (String(item?.kind || "").toLowerCase() !== "string") continue;
    if (String(item?.type || "").toLowerCase() !== "text/uri-list") continue;
    if (typeof item.getAsString !== "function") continue;
    pending.push(new Promise(resolve => {
      try {
        item.getAsString(value => resolve(filePromisesFromUriList(value)));
      } catch {
        resolve([]);
      }
    }).then(files => Promise.allSettled(files))
      .then(results => results
        .filter(result => result.status === "fulfilled" && result.value)
        .map(result => result.value)));
  }
  return pending;
}

function readTransferText(dataTransfer, type) {
  try {
    return typeof dataTransfer?.getData === "function" ? String(dataTransfer.getData(type) || "") : "";
  } catch {
    return "";
  }
}

function filePromisesFromUriList(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(fileFromLocalUri);
}

async function fileFromLocalUri(value) {
  let uri;
  try {
    uri = new URL(value);
  } catch {
    return null;
  }
  if (uri.protocol !== "file:") return null;
  if (uri.hostname && uri.hostname !== "localhost") return null;

  const blob = await fetchLocalFile(uri.href);
  if (!blob) return null;
  const name = localFileName(uri.pathname);
  const type = blob.type || mimeTypeFromName(name);
  try {
    if (typeof File !== "undefined") return new File([blob], name, { type, lastModified: Date.now() });
  } catch {}
  try {
    Object.defineProperty(blob, "name", { configurable: true, value: name });
  } catch {}
  return blob;
}

async function fetchLocalFile(uri) {
  if (typeof globalThis.fetch === "function") {
    try {
      const response = await globalThis.fetch(uri, { credentials: "omit" });
      if ((response.ok || response.status === 0) && typeof response.blob === "function") return await response.blob();
    } catch {}
  }
  const Xhr = globalThis.XMLHttpRequest;
  if (typeof Xhr !== "function") return null;
  return new Promise(resolve => {
    try {
      const request = new Xhr();
      request.open("GET", uri, true);
      request.responseType = "blob";
      request.onload = () => resolve(request.response instanceof Blob ? request.response : null);
      request.onerror = request.onabort = () => resolve(null);
      request.send();
    } catch {
      resolve(null);
    }
  });
}

function localFileName(pathname) {
  const encoded = String(pathname || "").split("/").filter(Boolean).at(-1) || "file";
  try { return decodeURIComponent(encoded); } catch { return encoded; }
}

function mimeTypeFromName(name) {
  const extension = String(name || "").toLowerCase().split(".").at(-1);
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
    pdf: "application/pdf", json: "application/json", txt: "text/plain"
  })[extension] || "application/octet-stream";
}

function uniqueFiles(files) {
  const seen = new Set();
  return files.filter(file => {
    const key = [file.name || "", file.size || 0, file.lastModified || 0, file.type || ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
