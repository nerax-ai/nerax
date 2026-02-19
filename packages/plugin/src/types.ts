import type { Logger } from '@nerax-ai/logger';

export type PluginLogger = Logger;

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  authorUrl?: string;
}

export interface Extension<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>> {
  type: TTypes;
  id: string;
  fullId: string;
  displayName?: string;
  description?: string;
  defaultOptions?: Record<string, unknown>;
  factory: TFactoryMap[TTypes];
  packageName: string;
}

export interface ExtensionOptions {
  displayName?: string;
  description?: string;
  defaultOptions?: Record<string, unknown>;
}

export type RegisterFn<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>> = <T extends TTypes>(
  type: T,
  id: string,
  factory: TFactoryMap[T],
  options?: ExtensionOptions,
) => void;

export interface PluginContext<TTypes extends string, TFactoryMap extends Record<TTypes, unknown>> {
  packageName: string;
  manifest: PluginManifest;
  logger: PluginLogger;
  storage: PluginStorage;
  register: RegisterFn<TTypes, TFactoryMap>;
}

export interface PluginModule<
  TTypes extends string = string,
  TFactoryMap extends Record<TTypes, unknown> = Record<TTypes, unknown>,
> {
  manifest?: PluginManifest;
  setup(ctx: PluginContext<TTypes, TFactoryMap>): void | Promise<void>;
  teardown?(ctx: PluginContext<TTypes, TFactoryMap>): void | Promise<void>;
}

export interface InlinePlugin<
  TTypes extends string = string,
  TFactoryMap extends Record<TTypes, unknown> = Record<TTypes, unknown>,
> {
  manifest: PluginManifest;
  setup(ctx: PluginContext<TTypes, TFactoryMap>): void | Promise<void>;
  teardown?(ctx: PluginContext<TTypes, TFactoryMap>): void | Promise<void>;
}

export interface PluginInstance<T = unknown> {
  instanceId: string;
  namespace: string;
  extensionFullId: string;
  options: Record<string, unknown>;
  value: T;
}
