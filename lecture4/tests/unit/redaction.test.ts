import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../src/core/redaction.ts';

describe('redactSecrets (MU4)', () => {
  it('api_key="..." (20文字以上) をマスクする', () => {
    const input = 'api_key="sk-abcdefghijklmnopqrstuvwxyz"';
    const out = redactSecrets(input);
    expect(out).toBe('api_key="[REDACTED]"');
    expect(out).not.toContain('abcdefghij');
  });

  it('secret: <20+ chars> をマスクする (label と sep は残す)', () => {
    const input = 'secret: abcdefghijklmnopqrstuvwxyz0123';
    const out = redactSecrets(input);
    expect(out).toBe('secret: [REDACTED]');
  });

  it('token = ... もマスクする (大文字小文字無視)', () => {
    const input = 'TOKEN = ABCDEFGHIJ1234567890_abc';
    const out = redactSecrets(input);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('ABCDEFGHIJ1234567890');
  });

  it('複数箇所をマスクする', () => {
    const input = 'api_key=aaaaaaaaaaaaaaaaaaaaaaaa and token=bbbbbbbbbbbbbbbbbbbbbbbb';
    const out = redactSecrets(input);
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(2);
  });

  it('短いトークン (<20 文字) はマスクしない', () => {
    const input = 'api_key=short123';
    expect(redactSecrets(input)).toBe(input);
  });

  it('マスク対象を含まない普通の文章はそのまま返る', () => {
    const input = 'これは普通のメモです。秘密の情報は含まれていません。';
    expect(redactSecrets(input)).toBe(input);
  });

  it('api-key (ハイフン形式) もマスクする', () => {
    const input = 'api-key: ZYXWVUTSRQPONMLKJIHGFEDCBA';
    expect(redactSecrets(input)).toBe('api-key: [REDACTED]');
  });
});
