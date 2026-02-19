import type {
  PluginLogger,
  PluginStorage,
  PluginContext,
  PluginModule,
  PluginManifest,
  InlinePlugin,
  Extension,
  ExtensionOptions,
  PluginInstance,
} from './types';
import { getLogger } from '@nerax-ai/logger';
import { getStorage } from '@nerax-ai/storage';

class MemoryPluginStorage implements PluginStorage {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

class FilePluginStorage implements PluginStorage {
  constructor(
    private readonly appName: string,
    private readonly packageName: string,
  ) {}
  private get store() {
    return getStorage(this.appName);
  }
  private get file() {
    return `plugins/${this.packageName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const data = (await this.store.data.readJSON<Record<string, unknown>>(this.file)) ?? {};
    return data[key] as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    const data = (await this.store.data.readJSON<Record<string, unknown>>(this.file)) ?? {};
    data[key] = value;
    await this.store.data.writeJSON(this.file, data);
  }
  async delete(key: string): Promise<void> {
    const data = (await this.store.data.readJSON<Record<string, unknown>>(this.file)) ?? {};
    delete data[key];
    await this.store.data.writeJSON(this.file, data);
  }
}

type SourceType = 'npm' | 'file' | 'git' | 'github';

function parseSource(source: string): { type: SourceType; ref: string; installArg: string } {
  if (source.startsWith('file:')) {
    const p = source.slice(5);
    const ref = p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : `${globalThis.process?.cwd?.() ?? '.'}/${p}`;
    return { type: 'file', ref, installArg: ref };
  }
  if (source.startsWith('github:')) return { type: 'github', ref: source.slice(7), installArg: source };
  if (source.startsWith('git:')) return { type: 'git', ref: source.slice(4), installArg: source.slice(4) };
  if (source.startsWith('npm:')) return { type: 'npm', ref: source.slice(4), installArg: source.slice(4) };
  return { type: 'npm', ref: source, installArg: source };
}

async function bunRun(args: string[], cwd: string, label: string, logger: PluginLogger): Promise<void> {
  const { spawn, execFileSync } = await import('node:child_process');
  let bunExe = 'bun';
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    bunExe = execFileSync(which, ['bun'], { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch { /* bun not found via which/where, fall back to PATH */ }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bunExe, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(new Error(`Plugin install failed for "${label}": ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Plugin install failed for "${label}": ${stderr.trim()}`));
      else {
        logger.info(`Installed plugin: ${label}`);
        resolve();
      }
    });
  });
}

async function readManifest(dir: string): Promise<PluginManifest | undefined> {
  try {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const manifestPath = path.join(dir, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return undefined;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
  } catch {
    return undefined;
  }
}

export interface PluginRegistryConfig {
  logger?: PluginLogger;
  appName?: string;
  storageFactory?: (packageName: string) => PluginStorage;
  pluginsDir?: string;
}

interface LoadedPlugin<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>> {
  packageName: string;
  manifest: PluginManifest;
  extensions: Map<string, Extension<TTypes, TFactoryMap>>;
  mod: PluginModule<TTypes, TFactoryMap> | InlinePlugin<TTypes, TFactoryMap>;
  ctx: PluginContext<TTypes, TFactoryMap>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRegistry = PluginRegistry<any, any>;

export class PluginRegistry<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>> {
  private static _instance: AnyRegistry | null = null;

  private readonly logger: PluginLogger;
  private readonly storageFactory: (packageName: string) => PluginStorage;
  private readonly pluginsDir: string;
  private readonly loaded = new Map<string, LoadedPlugin<TTypes, TFactoryMap>>();
  private readonly extensions = new Map<string, Extension<TTypes, TFactoryMap>>();
  private readonly shortNames = new Map<string, string>();
  /** instanceId → PluginInstance */
  private readonly instances = new Map<string, PluginInstance>();

  constructor(config: PluginRegistryConfig = {}) {
    this.logger = config.logger ?? getLogger(config.appName ?? 'nerax').scope('PluginRegistry');
    this.storageFactory =
      config.storageFactory ??
      (config.appName ? (pkg) => new FilePluginStorage(config.appName!, pkg) : () => new MemoryPluginStorage());
    if (config.pluginsDir) {
      this.pluginsDir = config.pluginsDir;
    } else if (config.appName) {
      this.pluginsDir = getStorage(config.appName).data.path;
    } else {
      this.pluginsDir = globalThis.process?.cwd?.() ?? '.';
    }
  }

  static getInstance<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>>(
    config?: PluginRegistryConfig,
  ): PluginRegistry<TTypes, TFactoryMap> {
    if (!PluginRegistry._instance) PluginRegistry._instance = new PluginRegistry(config);
    return PluginRegistry._instance as PluginRegistry<TTypes, TFactoryMap>;
  }

  static reset(): void {
    PluginRegistry._instance = null;
  }

  async load(source: string): Promise<void> {
    const { type, ref, installArg } = parseSource(source);
    const packageName = type === 'file' ? (ref.split(/[/\\]/).pop() ?? 'unknown') : ref;
    if (this.loaded.has(packageName)) return;

    this.logger.info(`Loading plugin: ${source}`);

    let mod: PluginModule<TTypes, TFactoryMap>;
    let pluginDir: string | undefined;

    if (type === 'file') {
      await bunRun(['install'], ref, source, this.logger);
      pluginDir = ref;
      const imported = await import(ref);
      mod = (imported.default ?? imported) as PluginModule<TTypes, TFactoryMap>;
    } else {
      await bunRun(['add', installArg], this.pluginsDir, source, this.logger);
      const path = await import('node:path');
      pluginDir = path.join(this.pluginsDir, 'node_modules', ref);
      const imported = await import(pluginDir);
      mod = (imported.default ?? imported) as PluginModule<TTypes, TFactoryMap>;
    }

    if (typeof mod.setup !== 'function') throw new Error(`Plugin "${packageName}" does not export a setup function`);

    const fileManifest = pluginDir ? await readManifest(pluginDir) : undefined;
    await this.runSetup(packageName, mod, fileManifest);
  }

  register(plugin: InlinePlugin<TTypes, TFactoryMap>): void {
    this.runSetup(plugin.manifest.id, plugin, plugin.manifest);
  }

  async unload(packageName: string): Promise<void> {
    const loaded = this.loaded.get(packageName);
    if (!loaded) return;

    // Call teardown if defined
    if (typeof loaded.mod.teardown === 'function') {
      await loaded.mod.teardown(loaded.ctx);
    }

    // Remove all instances belonging to this plugin's extensions
    const extFullIds = new Set(loaded.extensions.keys());
    for (const [instanceId, inst] of this.instances) {
      if (extFullIds.has(inst.extensionFullId)) {
        this.instances.delete(instanceId);
      }
    }

    // Remove extensions and short names
    for (const fullId of loaded.extensions.keys()) {
      this.extensions.delete(fullId);
      const ext = loaded.extensions.get(fullId)!;
      if (this.shortNames.get(ext.id) === fullId) {
        this.shortNames.delete(ext.id);
      }
    }

    this.loaded.delete(packageName);
    this.logger.info(`Plugin unloaded: ${packageName}`);
  }

  hasExtension(ref: string): boolean {
    return this.resolveExtension(ref) !== undefined;
  }

  listExtensions(type?: TTypes): Extension<TTypes, TFactoryMap>[] {
    const all = Array.from(this.extensions.values());
    return type ? all.filter((e) => e.type === type) : all;
  }

  listInstances(namespace?: string): PluginInstance[] {
    const all = Array.from(this.instances.values());
    return namespace ? all.filter((i) => i.namespace === namespace) : all;
  }

  async create<T extends TTypes>(
    type: T,
    ref: string,
    instanceId: string,
    options: Record<string, unknown> = {},
    namespace = 'default',
  ): Promise<unknown> {
    const ext = this.resolveExtension(ref);
    if (!ext) {
      const available = Array.from(this.extensions.values())
        .filter((e) => e.type === type)
        .map((e) => e.fullId)
        .join(', ');
      throw new Error(`${type} factory not found: "${ref}". Available: ${available}`);
    }
    if (ext.type !== type) throw new Error(`Extension "${ref}" is type "${ext.type}", not "${type}"`);

    const mergedOptions = { ...ext.defaultOptions, ...options };
    const factoryCtx = {
      instanceId,
      options: mergedOptions,
      logger: this.logger,
      storage: this.storageFactory(ext.packageName),
    };
    const value = await (ext.factory as (c: typeof factoryCtx) => unknown)(factoryCtx);

    this.instances.set(instanceId, {
      instanceId,
      namespace,
      extensionFullId: ext.fullId,
      options: mergedOptions,
      value,
    });

    return value;
  }

  /** Re-create an existing instance with the same (optionally overridden) options. */
  async reinitialize(instanceId: string, optionsOverride?: Record<string, unknown>): Promise<unknown> {
    const inst = this.instances.get(instanceId);
    if (!inst) throw new Error(`Instance not found: "${instanceId}"`);
    const ext = this.extensions.get(inst.extensionFullId);
    if (!ext) throw new Error(`Extension gone for instance: "${instanceId}"`);
    return this.create(
      ext.type as TTypes,
      inst.extensionFullId,
      instanceId,
      { ...inst.options, ...optionsOverride },
      inst.namespace,
    );
  }

  private async runSetup(
    packageName: string,
    mod: PluginModule<TTypes, TFactoryMap> | InlinePlugin<TTypes, TFactoryMap>,
    fileManifest?: PluginManifest,
  ): Promise<void> {
    if (this.loaded.has(packageName)) return;

    const manifest: PluginManifest = fileManifest ??
      mod.manifest ?? { id: packageName, name: packageName, version: '0.0.0' };
    const loadedPlugin: LoadedPlugin<TTypes, TFactoryMap> = {
      packageName,
      manifest,
      extensions: new Map(),
      mod,
      ctx: null!,
    };
    this.loaded.set(packageName, loadedPlugin);

    const storage = this.storageFactory(packageName);
    const ctx: PluginContext<TTypes, TFactoryMap> = {
      packageName,
      manifest,
      logger: this.logger,
      storage,
      register: ((type: TTypes, id: string, factory: TFactoryMap[TTypes], opts: ExtensionOptions = {}) => {
        const fullId = `${packageName}/${id}`;
        const ext: Extension<TTypes, TFactoryMap> = {
          type,
          id,
          fullId,
          factory,
          packageName,
          displayName: opts.displayName,
          description: opts.description,
          defaultOptions: opts.defaultOptions,
        };
        this.extensions.set(fullId, ext);
        if (!this.shortNames.has(id)) {
          this.shortNames.set(id, fullId);
        } else if (this.shortNames.get(id) !== fullId) {
          this.logger.warn(`Short name conflict: "${id}" already used by ${this.shortNames.get(id)}`);
        }
        loadedPlugin.extensions.set(fullId, ext);
        this.logger.debug(`Registered ${type}: ${fullId}`);
      }) as PluginContext<TTypes, TFactoryMap>['register'],
    };
    loadedPlugin.ctx = ctx;

    await mod.setup(ctx);
    this.logger.info(`Plugin loaded: ${packageName} (${loadedPlugin.extensions.size} extensions)`);
  }

  private resolveExtension(ref: string): Extension<TTypes, TFactoryMap> | undefined {
    if (this.extensions.has(ref)) return this.extensions.get(ref);
    const fullId = this.shortNames.get(ref);
    return fullId ? this.extensions.get(fullId) : undefined;
  }
}
