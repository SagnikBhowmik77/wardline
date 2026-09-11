import { afterEach, describe, expect, it } from 'vitest';

import { allowedOrigin, bearerFrom, hostIsLoopback, tokenMatches } from '../src/auth';
import { buildServer } from '../src/server';
import { memoryStore, stubGitHub } from './support';
import type { FastifyInstance } from 'fastify';

const TOKEN = 'a'.repeat(48);

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function guarded(): FastifyInstance {
  return buildServer({ store: memoryStore(), github: stubGitHub({}), token: TOKEN, webPort: 5180 });
}

describe('token checks', () => {
  it('compares in constant time and rejects a wrong length', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches('short', TOKEN)).toBe(false);
    expect(tokenMatches('b'.repeat(48), TOKEN)).toBe(false);
  });

  it('reads a bearer header and ignores other schemes', () => {
    expect(bearerFrom('Bearer abc')).toBe('abc');
    expect(bearerFrom('bearer abc')).toBe('abc');
    expect(bearerFrom('Basic abc')).toBe('');
    expect(bearerFrom(undefined)).toBe('');
  });
});

describe('host and origin checks', () => {
  it('accepts loopback hosts only', () => {
    expect(hostIsLoopback('localhost:8800')).toBe(true);
    expect(hostIsLoopback('127.0.0.1:8800')).toBe(true);
    // This is what a rebound DNS name looks like on arrival.
    expect(hostIsLoopback('evil.example.com')).toBe(false);
    expect(hostIsLoopback(undefined)).toBe(false);
  });

  it('accepts the dashboard origin and nothing else', () => {
    expect(allowedOrigin('http://localhost:5180', 5180)).toBe(true);
    expect(allowedOrigin('http://127.0.0.1:5180', 5180)).toBe(true);
    expect(allowedOrigin('https://evil.example.com', 5180)).toBe(false);
    // A different local port is still another application.
    expect(allowedOrigin('http://localhost:3000', 5180)).toBe(false);
    // curl and the CLI send no Origin at all.
    expect(allowedOrigin(undefined, 5180)).toBe(true);
  });
});

describe('the guarded API', () => {
  it('refuses a request with no token', async () => {
    app = guarded();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('token');
  });

  it('refuses a wrong token', async () => {
    app = guarded();
    const res = await app.inject({
      url: '/api/health',
      headers: { authorization: 'Bearer ' + 'b'.repeat(48) },
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows a correct token', async () => {
    app = guarded();
    const res = await app.inject({
      url: '/api/health',
      headers: { authorization: 'Bearer ' + TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('refuses a page on another origin even with the token', async () => {
    app = guarded();
    const res = await app.inject({
      url: '/api/health',
      headers: { authorization: 'Bearer ' + TOKEN, origin: 'https://evil.example.com' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('refuses a rebound hostname', async () => {
    app = guarded();
    const res = await app.inject({
      url: '/api/health',
      headers: { authorization: 'Bearer ' + TOKEN, host: 'attacker.example.com' },
    });

    expect(res.statusCode).toBe(421);
  });

  it('will not scan a local path without the token', async () => {
    app = guarded();
    const res = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { target: 'C:/Users' },
    });

    expect(res.statusCode).toBe(401);
  });
});
