import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateShortId, generateUniqueShortId } from '../../src/core/shortId.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateShortId (MU2)', () => {
  it('小文字 hex 6 文字を返す', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateShortId()).toMatch(/^[0-9a-f]{6}$/);
    }
  });
});

describe('generateUniqueShortId (MU2, E1)', () => {
  it('衝突しない id は 1 回で返す', () => {
    const exists = vi.fn().mockReturnValue(false);
    const id = generateUniqueShortId(exists);
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it('exists が最初の N 回 true → 以降 false で、未使用 id を返す (リトライ)', () => {
    let calls = 0;
    const exists = vi.fn().mockImplementation(() => {
      calls += 1;
      return calls <= 3; // 最初の 3 回は衝突
    });
    const id = generateUniqueShortId(exists);
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(exists).toHaveBeenCalledTimes(4); // 3 回衝突 + 4 回目で確定
    // 返した id は exists が false を返したもの (= 未使用)
    expect(exists(id)).toBe(false);
  });

  it('全試行で衝突したら Error を throw する', () => {
    const exists = vi.fn().mockReturnValue(true);
    expect(() => generateUniqueShortId(exists, 5)).toThrow();
    expect(exists).toHaveBeenCalledTimes(5);
  });

  it('デフォルト maxAttempts は 50', () => {
    const exists = vi.fn().mockReturnValue(true);
    expect(() => generateUniqueShortId(exists)).toThrow();
    expect(exists).toHaveBeenCalledTimes(50);
  });
});
