import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createLogger, getLogger } from '../src/index';
import { createStorage } from '../../storage/src/index';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nerax-logger-test-'));
  process.env.XDG_STATE_HOME = join(tmpDir, 'state');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_STATE_HOME;
});

function waitFlush() {
  return new Promise((r) => setTimeout(r, 100));
}

function readLog(dir: string) {
  const file = readdirSync(dir).find((f) => f.endsWith('.log'))!;
  return readFileSync(join(dir, file), 'utf-8');
}

describe('createLogger', () => {
  test('creates logger without config', () => {
    const log = createLogger({ console: false });
    expect(log).toHaveProperty('info');
    expect(log).toHaveProperty('scope');
  });

  test('baseDir prefixes all file paths', async () => {
    const baseDir = join(tmpDir, 'logs');
    const log = createLogger({
      console: false,
      baseDir,
      files: [{ filename: 'app-%DATE%.log', level: 'info' }],
    });
    log.info('test message');
    await waitFlush();
    expect(existsSync(baseDir)).toBe(true);
    expect(readdirSync(baseDir).length).toBeGreaterThan(0);
  });

  test('with storage: uses state dir as baseDir', async () => {
    const storage = createStorage('test-app');
    const log = createLogger({
      console: false,
      baseDir: storage.state.path,
      files: [{ filename: 'app-%DATE%.log', level: 'info' }],
    });
    log.info('storage-backed log');
    await waitFlush();
    expect(existsSync(storage.state.path)).toBe(true);
    expect(readdirSync(storage.state.path).length).toBeGreaterThan(0);
  });

  test('with storage: multiple files share baseDir', async () => {
    const storage = createStorage('test-app');
    const log = createLogger({
      console: false,
      baseDir: storage.state.path,
      files: [
        { filename: 'info-%DATE%.log', level: 'info' },
        { filename: 'error-%DATE%.log', level: 'error' },
      ],
    });
    log.info('info msg');
    log.error('error msg');
    await waitFlush();
    expect(readdirSync(storage.state.path).length).toBeGreaterThanOrEqual(2);
  });
});

describe('scope', () => {
  test('scope returns a Logger with scope method', () => {
    const log = createLogger({ console: false });
    const scoped = log.scope('plugin');
    expect(scoped).toHaveProperty('info');
    expect(scoped).toHaveProperty('scope');
  });

  test('scope prefixes messages in file output', async () => {
    const baseDir = join(tmpDir, 'scope-logs');
    const log = createLogger({
      console: false,
      baseDir,
      files: [{ filename: 'out-%DATE%.log', level: 'debug' }],
    });
    log.scope('plugin').info('hello');
    await waitFlush();
    const content = readLog(baseDir);
    expect(content).toContain('[plugin]');
    expect(content).toContain('hello');
  });

  test('nested scope accumulates brackets', async () => {
    const baseDir = join(tmpDir, 'nested-logs');
    const log = createLogger({
      console: false,
      baseDir,
      files: [{ filename: 'out-%DATE%.log', level: 'debug' }],
    });
    log.scope('a').scope('b').info('nested');
    await waitFlush();
    const content = readLog(baseDir);
    expect(content).toContain('[a][b]');
    expect(content).toContain('nested');
  });

  test('different scopes share same transports', async () => {
    const baseDir = join(tmpDir, 'shared-logs');
    const log = createLogger({
      console: false,
      baseDir,
      files: [{ filename: 'out-%DATE%.log', level: 'debug' }],
    });
    log.scope('a').info('from a');
    log.scope('b').info('from b');
    await waitFlush();
    const content = readLog(baseDir);
    expect(content).toContain('[a]');
    expect(content).toContain('[b]');
  });
});

describe('getLogger', () => {
  test('returns same instance for same appName', () => {
    const a = getLogger('cache-test');
    const b = getLogger('cache-test');
    expect(a).toBe(b);
  });

  test('appName appears in file output', async () => {
    const baseDir = join(tmpDir, 'appname-logs');
    const log = createLogger({
      appName: 'my-app',
      console: false,
      baseDir,
      files: [{ filename: 'out-%DATE%.log', level: 'debug' }],
    });
    log.info('hello');
    await waitFlush();
    const content = readLog(baseDir);
    expect(content).toContain('[my-app]');
  });
});
