import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

export interface StorageDir {
  readonly path: string;
  read(file: string): Promise<string | undefined>;
  write(file: string, content: string): Promise<void>;
  readJSON<T>(file: string): Promise<T | undefined>;
  writeJSON(file: string, data: unknown): Promise<void>;
  delete(file: string): Promise<void>;
}

function createDir(base: string): StorageDir {
  function ensure(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return {
    path: base,

    async read(file) {
      const p = path.join(base, file);
      if (!existsSync(p)) return undefined;
      return fs.readFile(p, 'utf8');
    },

    async write(file, content) {
      ensure(path.join(base, path.dirname(file)));
      await fs.writeFile(path.join(base, file), content, 'utf8');
    },

    async readJSON<T>(file: string) {
      const raw = await this.read(file);
      if (raw === undefined) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },

    async writeJSON(file, data) {
      await this.write(file, JSON.stringify(data, null, 2));
    },

    async delete(file) {
      const p = path.join(base, file);
      if (existsSync(p)) await fs.unlink(p);
    },
  };
}

export interface AppStorage {
  data: StorageDir;
  config: StorageDir;
  cache: StorageDir;
  state: StorageDir;
}

export function createStorage(appName: string): AppStorage {
  const home = os.homedir();
  return {
    data: createDir(path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), appName)),
    config: createDir(path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), appName)),
    cache: createDir(path.join(process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'), appName)),
    state: createDir(path.join(process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state'), appName)),
  };
}

const _cache = new Map<string, AppStorage>();

export function getStorage(appName: string): AppStorage {
  if (!_cache.has(appName)) _cache.set(appName, createStorage(appName));
  return _cache.get(appName)!;
}
