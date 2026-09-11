import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // node:sqlite is newer than Vite's builtin list, so it has to be named
    // explicitly or the transform tries to resolve it as a package.
    server: { deps: { external: [/^node:sqlite$/] } },
  },
  ssr: { external: ['node:sqlite'] },
  optimizeDeps: { exclude: ['node:sqlite'] },
});
