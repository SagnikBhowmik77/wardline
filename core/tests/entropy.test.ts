import { describe, expect, it } from 'vitest';

import { characterClasses, characterSpread, looksRandom, shannonEntropy } from '../src/util/entropy';

describe('entropy', () => {
  it('scores an empty string at zero and a uniform one near it', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
    expect(characterSpread('aaaaaaaa')).toBeCloseTo(0.125, 2);
  });

  it('rises with variety', () => {
    expect(shannonEntropy('S3cretPa55word')).toBeGreaterThan(shannonEntropy('password'));
  });

  it('counts character classes', () => {
    expect(characterClasses('abc')).toBe(1);
    expect(characterClasses('Abc1')).toBe(3);
    expect(characterClasses('Abc1!')).toBe(4);
  });

  it('calls a real key random and documentation not', () => {
    const random = [
      'q7Xb2M9pLt4Rv0NsKd8Wy3Hf',
      'aG9k-2Lm4Pq7Rt1Uv8Wx3Yz6',
      '7Kq2Vb9XmT4rLp0WzNs6Hj',
    ];
    const prose = [
      'your-client-secret',
      'password',
      'the quick brown fox jumps',
      'REPLACE_WITH_YOUR_KEY',
      'postgres',
    ];

    for (const value of random) expect(looksRandom(value), value).toBe(true);
    for (const value of prose) expect(looksRandom(value), value).toBe(false);
  });

  it('never calls a short string random, however varied', () => {
    expect(looksRandom('aB3!')).toBe(false);
    expect(looksRandom('')).toBe(false);
  });
});
