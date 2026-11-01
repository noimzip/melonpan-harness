/**
 * Browser-compatible safe shim for node:fs/promises, child_process, node:url etc.
 */
export const readdir = async () => [];
export const readFile = async () => '';
export const writeFile = async () => {};
export const stat = async () => ({ isFile: () => false, isDirectory: () => false });
export const access = async () => {};
export const mkdir = async () => {};
export const rm = async () => {};

export const fileURLToPath = (url: string | URL) => String(url);
export const pathToFileURL = (path: string) => new URL(`file://${path}`);

export const exec = (...args: any[]) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(null, '', '');
};
export const execFile = (...args: any[]) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(null, '', '');
};
export const spawn = () => ({
  stdout: { on: () => {} },
  stderr: { on: () => {} },
  on: (_evt: string, cb: any) => {
    if (_evt === 'close' && typeof cb === 'function') setTimeout(() => cb(0), 0);
  },
});

export default {
  readdir,
  readFile,
  writeFile,
  stat,
  access,
  mkdir,
  rm,
  fileURLToPath,
  pathToFileURL,
  exec,
  execFile,
  spawn,
};
