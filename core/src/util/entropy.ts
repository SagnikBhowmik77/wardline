/**
 * Shannon entropy, used to tell a real credential from a stand-in.
 *
 * A denylist of placeholder words needs extending every time somebody invents a
 * new way to write "changeme" - it has already been extended three times here.
 * Randomness needs no maintenance: `S3cretPa55word` and `password` differ by a
 * measure that holds for words nobody has thought of yet.
 */

export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);

  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }

  return bits;
}

/** Distinct characters as a share of length: "aaaaaaaaaa" scores near zero. */
export function characterSpread(value: string): number {
  if (value.length === 0) return 0;
  return new Set(value).size / value.length;
}

/** How many of lower, upper, digit and symbol the string draws on. */
export function characterClasses(value: string): number {
  return (
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/[0-9]/.test(value)) +
    Number(/[^A-Za-z0-9]/.test(value))
  );
}

/**
 * Whether a string carries enough randomness to be a live credential.
 *
 * Thresholds are deliberately conservative. A false negative costs one finding;
 * a false positive is a scanner that cries wolf over every line of example
 * documentation, which is how people learn to ignore it.
 */
export function looksRandom(value: string): boolean {
  const v = value.trim();
  if (v.length < 16) return false;
  // Prose clears the entropy bar on length alone. No credential has a space in
  // it, so whitespace is the cheapest way to tell a sentence from a secret.
  if (/\s/.test(v)) return false;
  // SCREAMING_SNAKE is a constant name, not a value: REPLACE_WITH_YOUR_KEY
  // clears every statistical bar while meaning the opposite of a secret.
  if (/^[A-Z0-9_]+$/.test(v) && v.includes('_')) return false;

  const entropy = shannonEntropy(v);
  const classes = characterClasses(v);

  if (entropy >= 4.0 && classes >= 3) return true;
  return entropy >= 3.6 && characterSpread(v) >= 0.6 && classes >= 2;
}
