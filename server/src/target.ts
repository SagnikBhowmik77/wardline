/**
 * What did the user actually type?
 *
 * One box accepts three things: a GitHub URL, an owner/repo slug, or a path on
 * this machine. Guessing wrong is what produced
 * "Nothing to scan at C:\...\server\https:\github.com\..." - a local path
 * resolver quietly swallowing a URL.
 */

export type Target =
  | { kind: 'repo'; slug: string }
  | { kind: 'path'; path: string }
  | { kind: 'invalid'; reason: string };

const SLUG_PART = '[A-Za-z0-9_.-]+';
const SLUG = new RegExp('^' + SLUG_PART + '/' + SLUG_PART + '$');

/** Strip the decoration people paste along with a repository address. */
function cleanSlug(raw: string): string {
  return raw
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .trim();
}

export function parseTarget(input: string): Target {
  const value = input.trim();
  if (value.length === 0) return { kind: 'invalid', reason: 'Enter a repository or a path.' };

  // A full URL: github.com/owner/repo, with or without scheme, and tolerant of
  // the /tree/main/... suffix the browser address bar leaves behind.
  const urlish = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(value);
  if (urlish) {
    const parts = cleanSlug(urlish[1] ?? '').split('/').filter(Boolean);
    if (parts.length < 2) {
      return { kind: 'invalid', reason: 'That GitHub URL has no repository in it.' };
    }
    const slug = parts[0] + '/' + parts[1];
    if (!SLUG.test(slug)) {
      return { kind: 'invalid', reason: 'Could not read a repository from that URL.' };
    }
    return { kind: 'repo', slug };
  }

  // Another host entirely: we only know how to fetch from GitHub.
  if (/^(?:https?|git|ssh):\/\//i.test(value) || /^git@/i.test(value)) {
    return {
      kind: 'invalid',
      reason: 'Only github.com repositories can be fetched. Clone it and scan the local path.',
    };
  }

  const slug = cleanSlug(value);
  if (SLUG.test(slug) && !slug.startsWith('.') && !/^[A-Za-z]:/.test(slug)) {
    return { kind: 'repo', slug };
  }

  return { kind: 'path', path: value };
}

/** What the interface should promise before the request is sent. */
export function describeTarget(target: Target): string {
  if (target.kind === 'repo') return 'Fetch ' + target.slug + ' from GitHub';
  if (target.kind === 'path') return 'Scan this path from disk';
  return target.reason;
}
