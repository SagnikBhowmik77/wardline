import type { Category, ConfigFile, Finding, Severity } from '../types.js';

export interface FindingDraft {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  remedy: string;
  line?: number;
  evidence?: string;
  autoFixable?: boolean;
}

/** Build a Finding, inheriting path and trust from the file it came from. */
export function report(file: ConfigFile, draft: FindingDraft): Finding {
  return {
    id: draft.id,
    category: draft.category,
    severity: draft.severity,
    title: draft.title,
    detail: draft.detail,
    remedy: draft.remedy,
    relPath: file.relPath,
    line: draft.line,
    evidence: draft.evidence,
    trust: file.trust,
    autoFixable: draft.autoFixable ?? false,
  };
}

/**
 * Words that appear as the password half of a connection string only in
 * documentation. A URI whose password is literally `password` is a template
 * line, not a leak - and database docs are full of them.
 */
const PLACEHOLDER_PASSWORDS =
  /^(?:password|passwd|pass|pwd|secret|key|mypassword|yourpassword|your_password|changeme|changeit|hunter2|123456|admin|root|token|apikey|api_key|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|guest|example|demo|dev|test|local|sample|<[^>]*>|\[[^\]]*\]|\{[^}]*\})$/i;

/** Generic user halves that only ever appear in a template connection string. */
const PLACEHOLDER_USERS =
  /^(?:user|username|identifier|myuser|dbuser|youruser|your_user|db_user|admin|root)$/i;

/** True when the text is clearly a stand-in rather than a live value. */
export function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return true;
  if (/^\$\{|^\$[A-Z_]+$|^process\.env|^env\./.test(v)) return true;
  if (/^<.+>$/.test(v)) return true;
  if (/x{6,}|\.{3}|\*{4,}/i.test(v)) return true;

  // A connection string carrying a documentation password, in either the
  // lower-case (user:password@host) or shouted (USER:PASSWORD@HOST) style.
  const uri = /:\/\/([^:@/\s]*):([^@/\s]+)@/.exec(v);
  if (uri) {
    const user = uri[1] ?? '';
    const password = uri[2] ?? '';

    if (PLACEHOLDER_PASSWORDS.test(password)) return true;
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(password)) return true;
    // Docker-compose defaults repeat the service name on both halves.
    if (user.length > 0 && user.toLowerCase() === password.toLowerCase()) return true;
    // A generic user half plus a short all-lowercase password half is a doc
    // template ("identifier:key"). A real secret has entropy in it.
    if (PLACEHOLDER_USERS.test(user) && /^[a-z]{1,12}$/.test(password)) return true;
  }
  // Self-describing stand-ins: YOUR_API_KEY_HERE, your-client-secret, <token>.
  if (/^(?:your|my|the|some|a)[-_]/i.test(v)) return true;
  if (/[-_](?:here|goes[-_]here)$/i.test(v)) return true;

  return /(example|placeholder|dummy|sample|redacted|changeme|change[-_ ]me|insert[-_ ]|replace[-_ ]me|todo|fake|your[-_ ]?key|abc123|xxx)/i.test(
    v,
  );
}

/** Collect every regex match with its 0-based offset. */
export function matchAll(
  content: string,
  regex: RegExp,
): { text: string; index: number; groups: string[] }[] {
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
  const re = new RegExp(regex.source, flags);
  const out: { text: string; index: number; groups: string[] }[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    out.push({ text: m[0], index: m.index, groups: m.slice(1).map((g) => g ?? '') });
    if (m[0].length === 0) re.lastIndex++;
    if (out.length > 500) break;
  }

  return out;
}
