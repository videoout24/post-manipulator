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

function arrayFrom(value) {
  try {
    return Array.from(value || []);
  } catch {
    return [];
  }
}
