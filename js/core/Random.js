/**
 * Web-Crypto compatible random helpers.
 * crypto.randomUUID() is only exposed in secure contexts in some browsers,
 * while crypto.getRandomValues() is much more widely available (including
 * the file:// workflow this project intentionally supports).
 */
export function randomBytes(length = 16) {
  const size = Math.max(0, Number(length) || 0);
  const bytes = new Uint8Array(size);
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }

  // Last-resort compatibility fallback. Identity in this application is local
  // and collision-checked by IndexedDB keys; security-sensitive bind material
  // still prefers getRandomValues whenever Web Crypto is available.
  let seed = (Date.now() ^ Math.floor((globalThis.performance?.now?.() || 0) * 1000)) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + i + Math.floor(Math.random() * 0x100000000)) >>> 0;
    bytes[i] = (seed ^ (seed >>> 13) ^ Math.floor(Math.random() * 256)) & 0xff;
  }
  return bytes;
}

export function randomUUID() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    try {
      return webCrypto.randomUUID();
    } catch {
      // Some browser/file contexts expose the method but reject calling it.
    }
  }

  const bytes = randomBytes(16);
  // RFC 4122 / RFC 9562 UUID v4 bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
