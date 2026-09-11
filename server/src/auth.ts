/**
 * Local API access control.
 *
 * Binding to loopback is not a boundary. Any page in your browser can reach
 * 127.0.0.1 while this server is running, and every endpoint here either scans
 * a path you name or returns what a previous scan found. Without a check, a
 * website you happen to open can read your filesystem through this process.
 *
 * Three things close that: a shared secret the browser must present, an origin
 * allowlist, and a Host check so a rebound DNS name cannot pose as localhost.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';

/** Where the token is left for the dev proxy to pick up. */
export function tokenPath(dataDir = '.data'): string {
  return join(dataDir, 'token');
}

/**
 * The token for this run: taken from the environment when set, otherwise
 * generated and written where the local dev proxy can read it.
 */
export function resolveToken(dataDir = '.data'): string {
  const fromEnv = process.env['WARDLINE_TOKEN'];
  if (fromEnv && fromEnv.trim().length >= 16) return fromEnv.trim();

  const path = tokenPath(dataDir);
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // No token yet: fall through and make one.
  }

  const token = randomBytes(24).toString('hex');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token, 'utf8');

  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows has no mode bits to set; the file still lives under .data.
  }

  return token;
}

/** Constant-time compare, so the token cannot be guessed a byte at a time. */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerFrom(header: string | undefined): string {
  if (!header) return '';
  const [scheme, value] = header.split(' ');
  if ((scheme ?? '').toLowerCase() !== 'bearer') return '';
  return (value ?? '').trim();
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Reject a Host header that is not loopback.
 *
 * DNS rebinding works by pointing a hostname the browser trusts at 127.0.0.1;
 * the request then arrives with that hostname in Host, not localhost.
 */
export function hostIsLoopback(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.split(':')[0] ?? '';
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}

/** Origins the dashboard is actually served from. */
export function allowedOrigin(origin: string | undefined, port: number): boolean {
  // A same-origin request, curl, or the CLI sends no Origin at all.
  if (!origin) return true;

  try {
    const url = new URL(origin);
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) && url.port === String(port);
  } catch {
    return false;
  }
}
