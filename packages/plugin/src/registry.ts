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
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

class MemoryPluginStorage implements PluginStorage {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.data.get(key) as T | undefined; }
  async set<T>(key: string, value: T): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

class FilePluginStorage implements PluginStorage {
  constructor(private readonly appName: string, private readonly packageName: string) {}
  private file() { return `plugins/${this.packageName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`; }
  private async read() { return (await getStorage(this.appName).data.readJSON<Record<string, unknown>>(this.file())) ?? {}; }
  async get<T>(key: string): Promise<T | undefined> { return (await this.read())[key] as T | undefined; }
  async set<T>(key: string, value: T): Promise<void> {
    const data = await this.read(); data[key] = value;
    await getStorage(this.appName).data.writeJSON(this.file(), data);
  }
  async delete(key: string): Promise<void> {
    const data = await this.read(); delete data[key];
    await getStorage(this.appName).data.writeJSON(this.file(), data);
  }
}

type SourceType = 'npm' | 'file' | 'git' | 'github';

function parseGithub(repo: string, branch?: string, subdir?: string) {
  return { type: 'github' as const, ref: repo, installArg: branch ? `github:${repo}#${branch}` : `github:${repo}`, branch, subdir };
}

function parseGit(url: string, branch?: string, subdir?: string) {
  return { type: 'git' as const, ref: url, installArg: branch ? `${url}#${branch}` : url, branch, subdir };
}

function splitAtBranchAndSubdir(raw: string): { base: string; branch?: string; subdir?: string } {
  const atIdx = raw.indexOf('@');
  const hashIdx = raw.indexOf('#');
  const base = atIdx !== -1 ? raw.slice(0, atIdx) : hashIdx !== -1 ? raw.slice(0, hashIdx) : raw;
  const branch = atIdx !== -1 ? (hashIdx !== -1 ? raw.slice(atIdx + 1, hashIdx) : raw.slice(atIdx + 1)) : undefined;
  const subdir = hashIdx !== -1 ? raw.slice(hashIdx + 1) : undefined;
  return { base, branch, subdir };
}

function parseSource(source: string): { type: SourceType; ref: string; installArg: string; branch?: string; subdir?: string } {
  if (source.startsWith('file:')) {
    const p = source.slice(5);
    const ref = p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : `${globalThis.process?.cwd?.() ?? '.'}/${p}`;
    return { type: 'file', ref, installArg: ref };
  }
  if (source.startsWith('/') || /^[A-Za-z]:[/\\]/.test(source)) return { type: 'file', ref: source, installArg: source };
  if (source.startsWith('github:')) { const { base, branch, subdir } = splitAtBranchAndSubdir(source.slice(7)); return parseGithub(base, branch, subdir); }
  if (source.startsWith('git:')) { const { base, branch, subdir } = splitAtBranchAndSubdir(source.slice(4)); return parseGit(base, branch, subdir); }
  if (source.startsWith('npm:')) return { type: 'npm', ref: source.slice(4), installArg: source.slice(4) };
  if (source.startsWith('https://') || source.startsWith('http://')) { const { base, branch, subdir } = splitAtBranchAndSubdir(source); return parseGit(base, branch, subdir); }
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+/.test(source)) { const { base, branch, subdir } = splitAtBranchAndSubdir(source); return parseGithub(base, branch, subdir); }
  return { type: 'npm', ref: source, installArg: source };
}

async function bunRun(args: string[], cwd: string, label: string, logger: PluginLogger): Promise<void> {
  const bunExe = (Bun.which('bun') ?? 'bun').replace(/\\/g, '/');
  const proc = Bun.spawn([bunExe, ...args], { cwd: cwd.replace(/\\/g, '/'), stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Plugin install failed for "${label}": ${(await new Response(proc.stderr).text()).trim()}`);
  logger.info(`Installed plugin: ${label}`);
}

function readManifest(dir: string): PluginManifest | undefined {
  try {
    const p = join(dir, 'manifest.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) as PluginManifest : undefined;
  } catch { return undefined; }
}

function readNpmVersion(pluginsDir: string, ref: string): string | undefined {
  try {
    const p = join(pluginsDir, 'node_modules', ref, 'package.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')).version : undefined;
  } catch { return undefined; }
}

async function fetchNpmVersion(pkg: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) return undefined;
    return ((await res.json()) as any).version;
  } catch { return undefined; }
}

async function fetchRemoteManifest(type: 'github' | 'git', ref: string, branch: string | undefined, subdir: string | undefined): Promise<PluginManifest | undefined> {
  try {
    let url: string;
    const b = branch ?? 'main';
    const path = subdir ? `${subdir}/manifest.json` : 'manifest.json';
    if (type === 'github') {
      url = `https://raw.githubusercontent.com/${ref}/${b}/${path}`;
    } else {
      // Convert git URL to raw: works for common hosts (github, gitlab, gitea)
      const base = ref.replace(/\.git$/, '');
      url = `${base}/raw/${b}/${path}`;
    }
    const res = await fetch(url);
    if (!res.ok) return undefined;
    return await res.json() as PluginManifest;
  } catch { return undefined; }
}

function resolvePluginDir(type: SourceType, ref: string, subdir: string | undefined, pluginsDir: string): string {
  if (type === 'file') return ref;
  return join(pluginsDir, 'node_modules', ref, ...(subdir ? [subdir] : []));
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

  private readonly baseLogger: PluginLogger;
  private readonly registryLogger: PluginLogger;
  private readonly storageFactory: (packageName: string) => PluginStorage;
  private readonly pluginsDir: string;
  private readonly loaded = new Map<string, LoadedPlugin<TTypes, TFactoryMap>>();
  private readonly extensions = new Map<string, Extension<TTypes, TFactoryMap>>();
  private readonly shortNames = new Map<string, string>();
  private readonly instances = new Map<string, PluginInstance>();

  constructor(config: PluginRegistryConfig = {}) {
    this.baseLogger = config.logger ?? getLogger(config.appName ?? 'nerax');
    this.registryLogger = this.baseLogger.scope('PluginRegistry');
    this.storageFactory =
      config.storageFactory ??
      (config.appName ? (pkg) => new FilePluginStorage(config.appName!, pkg) : () => new MemoryPluginStorage());
    this.pluginsDir = config.pluginsDir ?? (config.appName ? getStorage(config.appName).data.path : globalThis.process?.cwd?.() ?? '.');
  }

  static getInstance<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>>(
    config?: PluginRegistryConfig,
  ): PluginRegistry<TTypes, TFactoryMap> {
    if (!PluginRegistry._instance) PluginRegistry._instance = new PluginRegistry(config);
    return PluginRegistry._instance as PluginRegistry<TTypes, TFactoryMap>;
  }

  static reset(): void { PluginRegistry._instance = null; }

  async load(source: string): Promise<void> {
    const { type, ref, installArg, subdir } = parseSource(source);
    const packageName = type === 'file' ? (ref.split(/[/\\]/).pop() ?? 'unknown') : subdir ? `${ref}/${subdir}` : ref;

    // Check version before installing
    const existingDir = resolvePluginDir(type, ref, subdir, this.pluginsDir);
    const existingManifest = readManifest(existingDir);
    if (existingManifest) {
      const loaded = this.loaded.get(packageName);
      if (loaded && loaded.manifest.version === existingManifest.version) {
        this.registryLogger.info(`Plugin already loaded at version ${existingManifest.version}: ${packageName}`);
        return;
      }
    }

    this.registryLogger.info(`Loading plugin: ${source}`);

    let pluginDir: string;
    let mod: PluginModule<TTypes, TFactoryMap>;

    if (type === 'file') {
      await bunRun(['install'], ref, source, this.registryLogger);
      pluginDir = ref;
      const imported = await import(ref.replace(/\\/g, '/'));
      mod = (imported.default ?? imported) as PluginModule<TTypes, TFactoryMap>;
    } else {
      await bunRun(['add', installArg], this.pluginsDir, source, this.registryLogger);
      pluginDir = join(this.pluginsDir, 'node_modules', ref, ...(subdir ? [subdir] : []));
      const imported = await import(pluginDir);
      mod = (imported.default ?? imported) as PluginModule<TTypes, TFactoryMap>;
    }

    if (typeof mod.setup !== 'function') throw new Error(`Plugin "${packageName}" does not export a setup function`);

    const fileManifest = readManifest(pluginDir);
    const newVersion = fileManifest?.version ?? mod.manifest?.version;
    const loaded = this.loaded.get(packageName);
    if (loaded) {
      if (loaded.manifest.version === newVersion) {
        this.registryLogger.info(`Plugin already loaded at version ${newVersion}: ${packageName}`);
        return;
      }
      this.registryLogger.info(`Updating plugin ${packageName}: ${loaded.manifest.version} → ${newVersion}`);
      await this.unload(packageName);
    }

    await this.runSetup(packageName, mod, fileManifest);
  }

  /** Check remote/registry version without installing. Returns version string or undefined. */
  async checkVersion(source: string): Promise<string | undefined> {
    const { type, ref, branch, subdir } = parseSource(source);
    if (type === 'file') return readManifest(ref)?.version;
    if (type === 'npm') return fetchNpmVersion(ref);
    return (await fetchRemoteManifest(type as 'github' | 'git', ref, branch, subdir))?.version;
  }

  register(plugin: InlinePlugin<TTypes, TFactoryMap>): void {
    this.runSetup(plugin.manifest.id, plugin, plugin.manifest);
  }

  async unload(packageName: string): Promise<void> {
    const loaded = this.loaded.get(packageName);
    if (!loaded) return;

    if (typeof loaded.mod.teardown === 'function') await loaded.mod.teardown(loaded.ctx);

    const extFullIds = new Set(loaded.extensions.keys());
    for (const [instanceId, inst] of this.instances) {
      if (extFullIds.has(inst.extensionFullId)) this.instances.delete(instanceId);
    }

    for (const fullId of loaded.extensions.keys()) {
      this.extensions.delete(fullId);
      const ext = loaded.extensions.get(fullId)!;
      if (this.shortNames.get(ext.id) === fullId) this.shortNames.delete(ext.id);
    }

    this.loaded.delete(packageName);
    this.registryLogger.info(`Plugin unloaded: ${packageName}`);
  }

  hasExtension(ref: string): boolean { return this.resolveExtension(ref) !== undefined; }

  listExtensions(type?: TTypes): Extension<TTypes, TFactoryMap>[] {
    const all = [...this.extensions.values()];
    return type ? all.filter((e) => e.type === type) : all;
  }

  listInstances(namespace?: string): PluginInstance[] {
    const all = [...this.instances.values()];
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
      const available = [...this.extensions.values()].filter((e) => e.type === type).map((e) => e.fullId).join(', ');
      throw new Error(`${type} factory not found: "${ref}". Available: ${available}`);
    }
    if (ext.type !== type) throw new Error(`Extension "${ref}" is type "${ext.type}", not "${type}"`);

    const mergedOptions = { ...ext.defaultOptions, ...options };
    const value = await (ext.factory as (c: { instanceId: string; options: typeof mergedOptions; logger: PluginLogger; storage: PluginStorage }) => unknown)({
      instanceId, options: mergedOptions, logger: this.baseLogger.scope(ext.packageName), storage: this.storageFactory(ext.packageName),
    });

    this.instances.set(instanceId, { instanceId, namespace, extensionFullId: ext.fullId, options: mergedOptions, value });
    return value;
  }

  async reinitialize(instanceId: string, optionsOverride?: Record<string, unknown>): Promise<unknown> {
    const inst = this.instances.get(instanceId);
    if (!inst) throw new Error(`Instance not found: "${instanceId}"`);
    const ext = this.extensions.get(inst.extensionFullId);
    if (!ext) throw new Error(`Extension gone for instance: "${instanceId}"`);
    return this.create(ext.type as TTypes, inst.extensionFullId, instanceId, { ...inst.options, ...optionsOverride }, inst.namespace);
  }

  private async runSetup(
    packageName: string,
    mod: PluginModule<TTypes, TFactoryMap> | InlinePlugin<TTypes, TFactoryMap>,
    fileManifest?: PluginManifest,
  ): Promise<void> {
    if (this.loaded.has(packageName)) return;

    const manifest: PluginManifest = fileManifest ?? mod.manifest ?? { id: packageName, name: packageName, version: '0.0.0' };
    const loadedPlugin: LoadedPlugin<TTypes, TFactoryMap> = { packageName, manifest, extensions: new Map(), mod, ctx: null! };
    this.loaded.set(packageName, loadedPlugin);

    const ctx: PluginContext<TTypes, TFactoryMap> = {
      packageName, manifest, logger: this.baseLogger.scope(manifest.id), storage: this.storageFactory(packageName),
      register: ((type: TTypes, id: string, factory: TFactoryMap[TTypes], opts: ExtensionOptions = {}) => {
        const fullId = `${packageName}/${id}`;
        const ext: Extension<TTypes, TFactoryMap> = { type, id, fullId, factory, packageName, displayName: opts.displayName, description: opts.description, defaultOptions: opts.defaultOptions };
        this.extensions.set(fullId, ext);
        if (!this.shortNames.has(id)) this.shortNames.set(id, fullId);
        else if (this.shortNames.get(id) !== fullId) this.registryLogger.warn(`Short name conflict: "${id}" already used by ${this.shortNames.get(id)}`);
        loadedPlugin.extensions.set(fullId, ext);
        this.registryLogger.debug(`Registered ${type}: ${fullId}`);
      }) as PluginContext<TTypes, TFactoryMap>['register'],
    };
    loadedPlugin.ctx = ctx;

    await mod.setup(ctx);
    this.registryLogger.info(`Plugin loaded: ${packageName} (${loadedPlugin.extensions.size} extensions)`);
  }

  private resolveExtension(ref: string): Extension<TTypes, TFactoryMap> | undefined {
    if (this.extensions.has(ref)) return this.extensions.get(ref);
    const fullId = this.shortNames.get(ref);
    return fullId ? this.extensions.get(fullId) : undefined;
  }
}
