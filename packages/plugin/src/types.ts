import type { Logger } from '@nerax-ai/logger';

export type PluginLogger = Logger;

export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// === Schema Field Types ===

/**
 * Base properties shared by all schema field types
 */
interface SchemaFieldBase {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
  condition?: (values: Record<string, unknown>) => boolean;
  validate?: (value: unknown, values: Record<string, unknown>) => string | undefined;
}

/**
 * Enum option for select-style inputs
 */
export interface SchemaEnumOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * String field type - supports text input, select, password, and multiline
 */
export interface StringField extends SchemaFieldBase {
  type?: 'string'; // default
  default?: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  enum?: SchemaEnumOption[];
}

/**
 * Number field type - supports numeric input with constraints
 */
export interface NumberField extends SchemaFieldBase {
  type: 'number';
  default?: number;
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
}

/**
 * Boolean field type - supports checkbox/switch/confirm inputs
 */
export interface BooleanField extends SchemaFieldBase {
  type: 'boolean';
  default?: boolean;
}

/**
 * Union type for all schema field types.
 * Uses discriminated union pattern for type-safe field definitions.
 *
 * @example
 * ```typescript
 * const schema: Schema = {
 *   fields: [
 *     { name: 'apiKey', type: 'string', secret: true, required: true },
 *     { name: 'level', type: 'string', enum: [
 *       { value: 'debug', label: 'Debug' },
 *       { value: 'info', label: 'Info' },
 *     ]},
 *     { name: 'timeout', type: 'number', default: 5000, minimum: 0 },
 *     { name: 'enabled', type: 'boolean', default: true },
 *   ]
 * }
 * ```
 */
export type SchemaField = StringField | NumberField | BooleanField;

/**
 * Schema definition for extension options.
 * Used to generate forms in both Web UI and CLI interfaces.
 */
export interface Schema {
  fields?: SchemaField[];
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
  schema?: Schema;
  factory: TFactoryMap[TTypes];
  packageName: string;
}

export interface ExtensionOptions {
  displayName?: string;
  description?: string;
  defaultOptions?: Record<string, unknown>;
  schema?: Schema;
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
