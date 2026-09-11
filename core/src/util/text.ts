/** Small text helpers shared by the rule engine and reporters. */

/** 1-indexed line number of `needle` inside `haystack`, or undefined. */
export function lineOf(haystack: string, needle: string): number | undefined {
  if (!needle) return undefined;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return undefined;
  return haystack.slice(0, idx).split('\n').length;
}

/** 1-indexed line number for an absolute character offset. */
export function lineAt(haystack: string, offset: number): number {
  return haystack.slice(0, Math.max(0, offset)).split('\n').length;
}

/**
 * Shorten a secret to something safe to print: keep enough to locate it in the
 * file, never enough to use it.
 */
export function redact(value: string, keepStart = 6, keepEnd = 3): string {
  const v = value.trim();
  if (v.length <= keepStart + keepEnd + 3) return `${v.slice(0, 2)}***`;
  return `${v.slice(0, keepStart)}...${v.slice(-keepEnd)}`;
}

/** Collapse whitespace and clip, for one-line evidence in a terminal. */
export function oneLine(value: string, max = 100): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

/**
 * Strip `//` and block comments plus trailing commas so a JSONC-flavoured
 * settings file still parses. String literals are respected, so URLs survive.
 */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    const next = input[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch.charCodeAt(0) === 92) escaped = true; // backslash
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }

  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Escape a string for safe inclusion in generated HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lines of a shell script that actually execute - comments and blanks removed.
 * Returned with their original 1-indexed line numbers so findings stay anchored.
 */
export function executableLines(script: string): { line: number; text: string }[] {
  return script
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => {
      const t = text.trim();
      return t.length > 0 && !t.startsWith('#') && !t.startsWith('//');
    });
}
