import { defineConfig } from 'monoup';

export default defineConfig({
  monorepo: true,
  sourcemap: true,
  build: {
    main: false,
    typescript: {
      enabled: true,
      declaration: true,
      removeComments: false,
    },
    baseExternals: ['path', 'fs', 'crypto', 'stream', 'events'],
  },
  outDir: 'dist',
});
