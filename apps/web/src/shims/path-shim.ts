/**
 * Browser-compatible shim for node:path
 */
export function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function dirname(path: string): string {
  const parts = path.replace(/\/+/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '.';
}

export function basename(path: string, ext?: string): string {
  let base = path.split('/').pop() || '';
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export default {
  join,
  resolve,
  dirname,
  basename,
};
