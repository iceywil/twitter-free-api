import { describe, expect, it } from 'vitest';
import { Cubic } from '../src/transaction/cubicCurve.js';
import { interpolate } from '../src/transaction/interpolate.js';
import { convertRotationToMatrix } from '../src/transaction/rotation.js';
import { floatToHex, isOdd, pyRound, base64Encode } from '../src/transaction/utils.js';

describe('floatToHex', () => {
  // Values verified against the Python original.
  it('returns an empty string for zero', () => {
    expect(floatToHex(0)).toBe('');
  });

  it('renders whole numbers without a fraction', () => {
    expect(floatToHex(1)).toBe('1');
  });

  it('renders fractions with a leading dot', () => {
    expect(floatToHex(0.5)).toBe('.8');
    expect(floatToHex(0.25)).toBe('.4');
    expect(floatToHex(0.75)).toBe('.C');
  });
});

describe('pyRound', () => {
  it('breaks ties to even, like Python round()', () => {
    expect(pyRound(0.5)).toBe(0);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(-0.5)).toBe(0);
  });

  it('rounds normally away from ties', () => {
    expect(pyRound(1.2)).toBe(1);
    expect(pyRound(1.7)).toBe(2);
  });

  it('rounds to a given number of decimals', () => {
    expect(pyRound(1.005, 2)).toBeCloseTo(1.0, 5);
    expect(pyRound(1.2345, 2)).toBeCloseTo(1.23, 5);
  });
});

describe('isOdd', () => {
  it('returns -1 for odd and 0 for even, matching upstream', () => {
    expect(isOdd(0)).toBe(0);
    expect(isOdd(1)).toBe(-1);
    expect(isOdd(2)).toBe(0);
    expect(isOdd(3)).toBe(-1);
  });
});

describe('Cubic', () => {
  const cubic = new Cubic([0.1, 0.2, 0.3, 0.4]);

  it('clamps at the curve boundaries', () => {
    expect(cubic.getValue(0)).toBe(0);
    expect(cubic.getValue(-1)).toBeCloseTo(-2, 5);
  });

  it('is monotonic across the unit interval', () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const value = cubic.getValue(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  // Expected values captured from the Python original.
  it('matches the Python implementation', () => {
    expect(cubic.getValue(0.5)).toBeCloseTo(0.5624697925155218, 12);
    expect(cubic.getValue(0.25)).toBeCloseTo(0.3247457772501435, 12);
    expect(cubic.getValue(0)).toBe(0);
    expect(cubic.getValue(-1)).toBe(-2);
  });
});

describe('interpolate', () => {
  it('interpolates element-wise', () => {
    expect(interpolate([0, 10], [10, 20], 0.5)).toEqual([5, 15]);
  });

  it('rejects mismatched lengths', () => {
    expect(() => interpolate([1], [1, 2], 0.5)).toThrow(/Mismatched/);
  });
});

describe('convertRotationToMatrix', () => {
  it('produces an identity matrix at zero degrees', () => {
    const matrix = convertRotationToMatrix(0);
    expect(matrix[0]).toBeCloseTo(1, 10);
    expect(matrix[1]).toBeCloseTo(0, 10);
    expect(matrix[2]).toBeCloseTo(0, 10);
    expect(matrix[3]).toBeCloseTo(1, 10);
  });

  it('produces a quarter turn at ninety degrees', () => {
    const matrix = convertRotationToMatrix(90);
    expect(matrix[0]).toBeCloseTo(0, 10);
    expect(matrix[1]).toBeCloseTo(-1, 10);
    expect(matrix[2]).toBeCloseTo(1, 10);
  });
});

describe('base64Encode', () => {
  it('encodes bytes and strings alike', () => {
    expect(base64Encode('abc')).toBe('YWJj');
    expect(base64Encode(Uint8Array.from([97, 98, 99]))).toBe('YWJj');
  });
});
