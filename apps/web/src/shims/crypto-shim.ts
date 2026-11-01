/**
 * Browser-compatible shim for node:crypto createHash
 */
export function createHash(algorithm: string) {
  let buffer = '';
  return {
    update(data: string) {
      buffer += data;
      return this;
    },
    digest(encoding: 'hex' = 'hex') {
      // Deterministic 64-bit FNV-1a hash formatted as hex
      let h1 = 0x811c9dc5;
      let h2 = 0x811c9dc5;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 0x01000193);
        h2 = Math.imul(h2 ^ (ch << 1), 0x5bd1e995);
      }
      const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
      const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
      return p1 + p2;
    },
  };
}

export default {
  createHash,
};
