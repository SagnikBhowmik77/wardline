/**
 * A client-side reading of what the user typed, used only to tell them what the
 * button will do before they press it. The server re-parses independently and
 * remains the authority.
 */

export type Reading =
  | { kind: 'repo'; slug: string; say: string }
  | { kind: 'path'; say: string }
  | { kind: 'empty' }
  | { kind: 'invalid'; say: string };

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function readTarget(input: string): Reading {
  const value = input.trim();
  if (value.length === 0) return { kind: 'empty' };

  const urlish = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(value);
  if (urlish) {
    const parts = (urlish[1] ?? '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);

    if (parts.length < 2) {
      return { kind: 'invalid', say: 'That GitHub URL has no repository in it' };
    }

    const slug = parts[0] + '/' + parts[1];
    return { kind: 'repo', slug, say: 'Fetch ' + slug + ' from GitHub, add to corpus' };
  }

  if (/^(?:https?|git|ssh):\/\//i.test(value) || /^git@/i.test(value)) {
    return { kind: 'invalid', say: 'Only github.com can be fetched - clone it and scan the path' };
  }

  const slug = value.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (SLUG.test(slug) && !slug.startsWith('.') && !/^[A-Za-z]:/.test(slug)) {
    return { kind: 'repo', slug, say: 'Fetch ' + slug + ' from GitHub, add to corpus' };
  }

  return { kind: 'path', say: 'Scan this path from disk' };
}
