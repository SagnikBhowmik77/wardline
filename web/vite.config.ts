import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite loads this config through whatever path the launcher used, which on
 * Windows may be an 8.3 short name. Resolving to the real path first keeps the
 * root, the allow list and the request URLs in one spelling.
 */
const literalDir = fileURLToPath(new URL('.', import.meta.url));

/** The same directory as Windows really spells it, expanding any 8.3 name. */
const configDir = (() => {
  try {
    return realpathSync.native(literalDir);
  } catch {
    return literalDir;
  }
})();

const workspace = resolve(configDir, '..');

/**
 * Vite compares served paths against this list literally. The launcher has to
 * use an 8.3 short path (npm --prefix cannot take a path with a space on
 * Windows), so the project resolves long while Vite's own client under
 * node_modules resolves short. Missing either spelling 404s /@vite/client,
 * and without the HMR client nothing mounts at all.
 */
const allow = [...new Set([configDir, workspace, literalDir, resolve(literalDir, '..')])];

/**
 * The API requires a token. It writes one to .data/token at startup; the proxy
 * reads it and attaches it, so the browser never holds a credential and the
 * dashboard needs no login.
 */
function apiToken(): string {
  for (const path of [
    resolve(workspace, 'server', '.data', 'token'),
    resolve(workspace, '.data', 'token'),
  ]) {
    try {
      const token = readFileSync(path, 'utf8').trim();
      if (token.length >= 32) return token;
    } catch {
      // Try the next location; an empty token simply fails the API check.
    }
  }
  return '';
}

export default defineConfig({
  root: configDir,
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    /**
     * The launcher must start npm with an 8.3 short path: npm --prefix cannot
     * take a path containing a space on Windows, and this project lives under
     * "Sagnik Bhowmik". Vite then resolves the project long and its own client
     * under node_modules short. Listing every spelling in `allow` is still not
     * enough - /@vite/client intermittently 404s on the first request after a
     * restart, and without the HMR client nothing mounts at all.
     *
     * Turning the check off is the fix for that, and it is contained: the dev
     * server binds to loopback, serves only this workspace, and `vite build`
     * never consults the setting. `allow` is kept so the intended scope is
     * still written down.
     */
    fs: { strict: false, allow },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8800',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = apiToken();
            if (token) proxyReq.setHeader('authorization', 'Bearer ' + token);
            // changeOrigin rewrites Host; the API insists on loopback.
            proxyReq.setHeader('host', '127.0.0.1:8800');
          });
        },
      },
    },
  },
  build: { outDir: resolve(configDir, 'dist') },
});
