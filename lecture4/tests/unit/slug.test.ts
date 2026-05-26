import { describe, it, expect } from 'vitest';
import { isValidSlug, fallbackSlug, resolveSlug } from '../../src/core/slug.ts';

describe('isValidSlug (MU1)', () => {
  it('正常な slug を受理する', () => {
    expect(isValidSlug('prompt-caching-ttl')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('a'.repeat(60))).toBe(true);
    expect(isValidSlug('memo-20260526-091500')).toBe(true);
  });

  it('NG ケースを拒否する', () => {
    expect(isValidSlug('Prompt-Caching')).toBe(false); // 大文字
    expect(isValidSlug('')).toBe(false); // 空
    expect(isValidSlug('a'.repeat(61))).toBe(false); // 61 文字超
    expect(isValidSlug('foo_bar')).toBe(false); // アンダースコア
    expect(isValidSlug('foo bar')).toBe(false); // スペース
    expect(isValidSlug('日本語')).toBe(false); // 非 ASCII
    expect(isValidSlug('foo.bar')).toBe(false); // ドット
  });
});

describe('fallbackSlug (MU1)', () => {
  it('memo-YYYYMMDD-HHMMSS 形式 (ローカル時刻, ゼロ埋め) を返す', () => {
    const now = new Date(2026, 4, 26, 9, 1, 5); // 2026-05-26 09:01:05 local
    expect(fallbackSlug(now)).toBe('memo-20260526-090105');
  });

  it('生成した fallbackSlug は isValidSlug を満たす', () => {
    const now = new Date(2026, 11, 31, 23, 59, 59);
    const s = fallbackSlug(now);
    expect(s).toMatch(/^memo-\d{8}-\d{6}$/);
    expect(isValidSlug(s)).toBe(true);
  });
});

describe('resolveSlug (MU1)', () => {
  const now = new Date(2026, 4, 26, 9, 1, 5);

  it('candidate が valid ならそのまま返す', () => {
    expect(resolveSlug('prompt-caching-ttl', now)).toBe('prompt-caching-ttl');
  });

  it('candidate が invalid なら fallback を返す', () => {
    expect(resolveSlug('Invalid Slug!', now)).toBe('memo-20260526-090105');
    expect(resolveSlug('', now)).toBe('memo-20260526-090105');
  });
});
