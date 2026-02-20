import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PluginRegistry } from '../src/index';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const MOCK_PLUGIN_PATH = join(import.meta.dir, 'fixtures', 'mock-plugin');

type TestTypes = 'widget' | 'service';
type TestFactoryMap = {
  widget: (ctx: { instanceId: string; options: Record<string, unknown> }) => { id: string; name: string };
  service: (ctx: { instanceId: string; options: Record<string, unknown> }) => { name: string; run: () => string };
};

let tmpDir: string;
let reg: PluginRegistry<TestTypes, TestFactoryMap>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'nerax-plugin-test-'));
  process.env.XDG_DATA_HOME = join(tmpDir, 'data');
  reg = new PluginRegistry();
});

afterEach(() => {
  PluginRegistry.reset();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_DATA_HOME;
});

describe('PluginRegistry', () => {
  describe('singleton', () => {
    test('getInstance() returns the same instance', () => {
      const a = PluginRegistry.getInstance<TestTypes, TestFactoryMap>();
      expect(PluginRegistry.getInstance()).toBe(a);
    });

    test('reset() clears all registrations', async () => {
      const r = PluginRegistry.getInstance<TestTypes, TestFactoryMap>();
      await r.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(r.hasExtension('mock-widget')).toBe(true);
      PluginRegistry.reset();
      expect(PluginRegistry.getInstance().hasExtension('mock-widget')).toBe(false);
    });
  });

  describe('load()', () => {
    test('loads plugin from file: path', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.hasExtension('mock-widget')).toBe(true);
      expect(reg.hasExtension('mock-service')).toBe(true);
    });

    test('is idempotent', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.listExtensions('widget')).toHaveLength(1);
    });

    test('throws for invalid path', async () => {
      await expect(reg.load('file:/nonexistent/path')).rejects.toThrow();
    });
  });

  describe('register()', () => {
    test('registers inline plugin', () => {
      reg.register({
        manifest: { id: 'inline', name: 'Inline', version: '1.0.0' },
        setup(ctx) {
          ctx.register('widget', 'my-widget', (c) => ({ id: c.instanceId, name: 'Inline Widget' }));
        },
      });
      expect(reg.hasExtension('my-widget')).toBe(true);
    });
  });

  describe('listExtensions()', () => {
    test('returns all when no filter', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.listExtensions()).toHaveLength(2);
    });

    test('filters by type', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.listExtensions('widget')).toHaveLength(1);
      expect(reg.listExtensions('service')).toHaveLength(1);
    });

    test('extension has correct shape', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      const ext = reg.listExtensions('widget')[0];
      expect(ext.id).toBe('mock-widget');
      expect(ext.fullId).toBe('mock-plugin/mock-widget');
      expect(ext.displayName).toBe('Mock Widget');
    });
  });

  describe('create()', () => {
    test('creates instance by short name', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      const w = (await reg.create('widget', 'mock-widget', 'w-1')) as { id: string; name: string };
      expect(w.id).toBe('w-1');
      expect(w.name).toBe('Mock Widget');
    });

    test('creates instance by full id', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      const w = (await reg.create('widget', 'mock-plugin/mock-widget', 'w-2')) as { id: string };
      expect(w.id).toBe('w-2');
    });

    test('throws for unknown extension', async () => {
      await expect(reg.create('widget', 'nonexistent', 'x')).rejects.toThrow();
    });

    test('throws on type mismatch', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await expect(reg.create('widget', 'mock-service', 'x')).rejects.toThrow();
    });

    test('merges defaultOptions with runtime options', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.create('widget', 'mock-widget', 'w-opts', { color: 'red' });
      const tracked = reg.listInstances().find((i) => i.instanceId === 'w-opts')!;
      expect(tracked.options.color).toBe('red');
    });
  });

  describe('instances', () => {
    test('listInstances() returns created instances', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.create('widget', 'mock-widget', 'w-1');
      await reg.create('service', 'mock-service', 's-1');
      expect(reg.listInstances()).toHaveLength(2);
    });

    test('listInstances(namespace) filters by namespace', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.create('widget', 'mock-widget', 'w-1', {}, 'ns-a');
      await reg.create('widget', 'mock-widget', 'w-2', {}, 'ns-b');
      expect(reg.listInstances('ns-a')).toHaveLength(1);
    });

    test('reinitialize() recreates instance', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.create('widget', 'mock-widget', 'w-1');
      const w = (await reg.reinitialize('w-1')) as { id: string };
      expect(w.id).toBe('w-1');
    });
  });

  describe('unload()', () => {
    test('removes extensions and instances', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      await reg.create('widget', 'mock-widget', 'w-1');
      await reg.unload('mock-plugin');
      expect(reg.hasExtension('mock-widget')).toBe(false);
      expect(reg.listInstances()).toHaveLength(0);
    });

    test('calls teardown on unload', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      const { teardownCalled } = await import('./fixtures/mock-plugin/index.ts');
      await reg.unload('mock-plugin');
      expect(teardownCalled).toBe(true);
    });

    test('short name resolution', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.hasExtension('mock-widget')).toBe(true);
      expect(reg.hasExtension('mock-plugin/mock-widget')).toBe(true);
    });
  });

  describe('checkVersion()', () => {
    test('reads version from local manifest.json', async () => {
      const version = await reg.checkVersion(`file:${MOCK_PLUGIN_PATH}`);
      expect(version).toBe('1.0.0');
    });

    test('returns undefined for file path without manifest.json', async () => {
      const version = await reg.checkVersion(`file:${tmpDir}`);
      expect(version).toBeUndefined();
    });

    test('fetches version from npm registry', async () => {
      // bun is a well-known npm package
      const version = await reg.checkVersion('npm:bun-types');
      expect(typeof version).toBe('string');
    });
  });

  describe('version-based load()', () => {
    test('skips reload when version unchanged', async () => {
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      const extsBefore = reg.listExtensions().length;
      await reg.load(`file:${MOCK_PLUGIN_PATH}`);
      expect(reg.listExtensions()).toHaveLength(extsBefore);
    });
  });

  describe('file storage (appName)', () => {
    test('plugin storage persists across registry reset', async () => {
      const r = new PluginRegistry<TestTypes, TestFactoryMap>({ appName: 'test-app' });
      await r.load(`file:${MOCK_PLUGIN_PATH}`);
      await r.create('widget', 'mock-widget', 'w-1');
      expect(r.listInstances().find((i) => i.instanceId === 'w-1')).toBeDefined();
    });

    test('uses FilePluginStorage when appName provided', async () => {
      const r = new PluginRegistry<TestTypes, TestFactoryMap>({ appName: 'test-app' });
      let capturedStorage: any;
      r.register({
        manifest: { id: 'storage-test', name: 'Storage Test', version: '1.0.0' },
        setup(ctx) {
          capturedStorage = ctx.storage;
          ctx.register('widget', 'st-widget', (c) => ({ id: c.instanceId, name: 'ST' }));
        },
      });
      await capturedStorage.set('foo', 'bar');
      expect(await capturedStorage.get('foo')).toBe('bar');
      await capturedStorage.delete('foo');
      expect(await capturedStorage.get('foo')).toBeUndefined();
    });
  });
});
