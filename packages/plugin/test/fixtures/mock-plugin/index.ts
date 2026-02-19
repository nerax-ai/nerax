import type { PluginModule } from '../../../src/index';

type TestTypes = 'widget' | 'service';
type TestFactoryMap = {
  widget: (ctx: { instanceId: string; options: Record<string, unknown> }) => { id: string; name: string };
  service: (ctx: { instanceId: string; options: Record<string, unknown> }) => { name: string; run: () => string };
};

let teardownCalled = false;
export { teardownCalled };

export default {
  manifest: { id: '@test/mock-plugin', name: 'Mock Plugin', version: '1.0.0' },

  setup(ctx) {
    ctx.register('widget', 'mock-widget', (c) => ({ id: c.instanceId, name: 'Mock Widget' }), {
      displayName: 'Mock Widget',
      defaultOptions: { color: 'blue' },
    });

    ctx.register(
      'service',
      'mock-service',
      (c) => ({
        name: c.instanceId,
        run: () => 'ok',
      }),
      { displayName: 'Mock Service' },
    );
  },

  teardown() {
    teardownCalled = true;
  },
} satisfies PluginModule<TestTypes, TestFactoryMap>;
