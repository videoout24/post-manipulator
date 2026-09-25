const LINUX_FILE_TRANSFER_TYPES = new Set([
  "application/x-moz-file",
  "text/uri-list"
]);

export function dataTransferMayContainFiles(dataTransfer) {
  if (!dataTransfer) return false;
  if (arrayFrom(dataTransfer.files).length) return true;
  if (arrayFrom(dataTransfer.items).some(item => String(item?.kind || "").toLowerCase() === "file")) return true;
  return arrayFrom(dataTransfer.types).some(type => {
    const normalized = String(type || "").toLowerCase();
    return normalized === "files" || LINUX_FILE_TRANSFER_TYPES.has(normalized);
  });
}

export function filesFromDataTransfer(dataTransfer) {
  const files = arrayFrom(dataTransfer?.files).filter(Boolean);
  if (files.length) return files;
  return arrayFrom(dataTransfer?.items)
    .filter(item => String(item?.kind || "").toLowerCase() === "file")
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
  const pending = asyncFilesFromDataTransfer(dataTransfer);
  if (!pending.length) return [];
  const settled = await Promise.allSettled(pending);
  return uniqueFiles(settled
    .filter(result => result.status === "fulfilled" && result.value)
    .map(result => result.value));
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
    && typeof value.arrayBuffer === "function"
    && Number.isFinite(Number(value.size));
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
    if (String(item?.kind || "").toLowerCase() !== "file") continue;
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

function uniqueFiles(files) {
  const seen = new Set();
  return files.filter(file => {
    const key = [file.name || "", file.size || 0, file.lastModified || 0, file.type || ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
