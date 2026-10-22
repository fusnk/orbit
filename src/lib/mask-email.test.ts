import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('someone@example.com')).toBe('s•••@example.com');
    expect(maskEmail('a@b.co')).toBe('a•••@b.co');
  });

  it('leaves what isn’t an address alone', () => {
    expect(maskEmail('name')).toBe('name');
    expect(maskEmail('@example.com')).toBe('@example.com');
    expect(maskEmail('')).toBe('');
  });
});
