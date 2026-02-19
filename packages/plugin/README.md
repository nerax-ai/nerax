# @nerax-ai/plugin

Type-safe plugin registry for extensible applications.

## Usage

```ts
import { PluginRegistry } from '@nerax-ai/plugin';

type ExtType = 'provider' | 'handler';
type FactoryMap = {
  provider: (ctx: { instanceId: string; options: Record<string, unknown> }) => Provider;
  handler: (ctx: { instanceId: string; options: Record<string, unknown> }) => Handler;
};

const registry = PluginRegistry.getInstance<ExtType, FactoryMap>({ appName: 'my-app' });
```

## Loading Plugins

```ts
// From local path
await registry.load('file:/path/to/plugin');

// From npm
await registry.load('my-plugin');

// Inline
registry.register({
  manifest: { id: 'my-plugin', name: 'My Plugin', version: '1.0.0' },
  setup(ctx) {
    ctx.register('provider', 'my-provider', (c) => new MyProvider(c.options));
  },
});
```

## Managing Plugins

```ts
// Unload a plugin (calls teardown if defined, removes all its extensions and instances)
await registry.unload('my-plugin');

// List extensions, optionally filtered by type
registry.listExtensions();           // all
registry.listExtensions('provider'); // only providers

// List created instances, optionally filtered by namespace
registry.listInstances();
registry.listInstances('default');
```

## Creating Instances

```ts
// create(type, ref, instanceId, options?, namespace?)
const provider = await registry.create('provider', 'my-provider', 'p-1', { model: 'gpt-4' });

// Re-create with same or overridden options
await registry.reinitialize('p-1', { model: 'gpt-3.5' });
```

Extension `ref` can be a short name (`my-provider`) or full id (`my-plugin/my-provider`).

## Persistent Storage

Pass `appName` to automatically store plugin data under the XDG data directory:

```ts
const registry = PluginRegistry.getInstance({ appName: 'my-app' });
// plugins dir: ~/.local/share/my-app/
// plugin data persisted via @nerax-ai/storage
```

## Writing a Plugin

```ts
// plugin/index.ts
import type { PluginModule } from '@nerax-ai/plugin';

export default {
  setup(ctx) {
    ctx.register('provider', 'my-provider', (c) => new MyProvider(c.options), {
      displayName: 'My Provider',
      defaultOptions: { timeout: 30000 },
    });
  },
  teardown(ctx) {
    // optional cleanup
  },
} satisfies PluginModule;
```

Place a `plugin.json` manifest alongside the entry file:

```json
{ "id": "my-plugin", "name": "My Plugin", "version": "1.0.0" }
```
