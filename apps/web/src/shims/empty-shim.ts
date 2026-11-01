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

export const exec = () => {};
export const execFile = () => {};
export const spawn = () => {};

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
