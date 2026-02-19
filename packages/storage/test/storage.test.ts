import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createStorage, getStorage } from '../src/index';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nerax-storage-test-'));
  process.env.XDG_CONFIG_HOME = join(tmpDir, 'config');
  process.env.XDG_DATA_HOME = join(tmpDir, 'data');
  process.env.XDG_CACHE_HOME = join(tmpDir, 'cache');
  process.env.XDG_STATE_HOME = join(tmpDir, 'state');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CACHE_HOME;
  delete process.env.XDG_STATE_HOME;
});

describe('createStorage', () => {
  test('paths resolve to xdg dirs with app name', () => {
    const s = createStorage('test-app');
    expect(s.config.path).toBe(join(tmpDir, 'config', 'test-app'));
    expect(s.data.path).toBe(join(tmpDir, 'data', 'test-app'));
    expect(s.cache.path).toBe(join(tmpDir, 'cache', 'test-app'));
    expect(s.state.path).toBe(join(tmpDir, 'state', 'test-app'));
  });

  test('read returns undefined for missing file', async () => {
    const s = createStorage('test-app');
    expect(await s.config.read('missing.txt')).toBeUndefined();
  });

  test('write then read', async () => {
    const s = createStorage('test-app');
    await s.config.write('hello.txt', 'world');
    expect(await s.config.read('hello.txt')).toBe('world');
  });

  test('write creates nested directories', async () => {
    const s = createStorage('test-app');
    await s.data.write('a/b/c.txt', 'nested');
    expect(await s.data.read('a/b/c.txt')).toBe('nested');
  });

  test('writeJSON then readJSON', async () => {
    const s = createStorage('test-app');
    await s.cache.writeJSON('data.json', { x: 1 });
    expect(await s.cache.readJSON<{ x: number }>('data.json')).toEqual({ x: 1 });
  });

  test('readJSON returns undefined for missing file', async () => {
    const s = createStorage('test-app');
    expect(await s.state.readJSON('nope.json')).toBeUndefined();
  });

  test('delete removes file', async () => {
    const s = createStorage('test-app');
    await s.config.write('del.txt', 'bye');
    await s.config.delete('del.txt');
    expect(await s.config.read('del.txt')).toBeUndefined();
  });

  test('delete is a no-op for missing file', async () => {
    const s = createStorage('test-app');
    await expect(s.config.delete('ghost.txt')).resolves.toBeUndefined();
  });
});

describe('getStorage', () => {
  test('returns same instance for same appName', () => {
    expect(getStorage('my-app')).toBe(getStorage('my-app'));
  });
});
