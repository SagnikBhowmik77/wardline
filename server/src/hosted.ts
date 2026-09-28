/**
 * Hosted mode.
 *
 * Everything this server does locally is fine on loopback and wrong on the
 * public internet. One endpoint reads any path it is given; on a developer's
 * machine that is the feature, on a host it is a filesystem reader with a URL.
 *
 * So hosted mode is a different product, not the same one with a firewall:
 *
 *   - scanning a local path is refused outright, not merely unauthenticated
 *   - reading the corpus is public, because there is nothing there to protect
 *     and a demo nobody can open is not a demo
 *   - anything that spends the GitHub rate limit or writes still needs the token
 */

export function isHosted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['WARDLINE_HOSTED'] === '1' || env['RENDER'] === 'true';
}

/** Endpoints anyone may read on a public deployment. */
const PUBLIC_READS = [
  '/api/health',
  '/api/rules',
  '/api/scans',
  '/api/history',
  '/api/benchmark',
  '/api/corpus/stats',
  '/api/repos',
];

/**
 * A GET against corpus data is public. Everything else - ingest, local scans,
 * anything with side effects - still has to prove it holds the token.
 */
export function isPublicRead(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;

  const raw = url.split('?')[0] ?? '';
  const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;

  // The dashboard and its assets are not API calls, and a page nobody can
  // load is not a deployment. Anything under /api/ still has to be listed.
  if (!path.startsWith('/api/') && path !== '/api') return true;

  return PUBLIC_READS.some((p) => path === p || path.startsWith(p + '/'));
}

/**
 * Origins allowed on a public deployment.
 *
 * The dashboard is served from the same origin, so the only Origin worth
 * accepting is the deployment's own. Comparing against the request's Host
 * rather than a configured hostname means this keeps working behind a custom
 * domain, a preview URL, or a platform that renames things - and a wrong
 * environment variable cannot lock every visitor out.
 */
export function hostedOriginAllowed(
  origin: string | undefined,
  selfHost: string | undefined,
): boolean {
  if (!origin) return true;
  if (!selfHost) return false;

  try {
    return new URL(origin).host.toLowerCase() === selfHost.toLowerCase();
  } catch {
    return false;
  }
}

export const LOCAL_SCAN_REFUSED =
  'This deployment does not scan local paths. It only reads public GitHub ' +
  'repositories. Run Wardline on your own machine to audit a directory: ' +
  'npx wardline scan --path .';
