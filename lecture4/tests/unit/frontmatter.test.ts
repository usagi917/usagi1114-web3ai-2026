import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { Frontmatter } from '../../src/types.ts';
import { serializeMemo, parseMemo } from '../../src/core/frontmatter.ts';

function makeFm(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    source: 'manual',
    source_id: '2026-05-26T09-01-05+09-00-abc123',
    captured_at: '2026-05-26T09:01:05+09:00',
    slug: 'prompt-caching-ttl',
    short_id: 'abc123',
    tags: [],
    agent_summary: 'プロンプトキャッシュの TTL についてのメモ',
    agent_model: 'claude-sonnet-4-6',
    truncated: false,
    deleted: false,
    ...overrides,
  };
}

describe('serializeMemo / parseMemo round-trip (MU3)', () => {
  it('frontmatter と body が往復で一致する', () => {
    const fm = makeFm();
    const body = '# 見出し\n\n本文テキスト。';
    const serialized = serializeMemo(fm, body);
    const parsed = parseMemo(serialized);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body).toBe(body);
  });

  it('スキーマのキー順で YAML を出力する', () => {
    const fm = makeFm();
    const serialized = serializeMemo(fm, 'body');
    const yamlBlock = serialized.slice(
      '---\n'.length,
      serialized.indexOf('\n---\n'),
    );
    const keys = yamlBlock
      .split('\n')
      .filter((l) => /^[a-z_]+:/.test(l))
      .map((l) => l.split(':')[0]);
    expect(keys).toEqual([
      'source',
      'source_id',
      'captured_at',
      'slug',
      'short_id',
      'tags',
      'agent_summary',
      'agent_model',
      'truncated',
      'deleted',
    ]);
  });

  it('--- 区切りと末尾改行が仕様どおり', () => {
    const serialized = serializeMemo(makeFm(), 'body');
    expect(serialized.startsWith('---\n')).toBe(true);
    expect(serialized).toContain('\n---\n\n');
    expect(serialized.endsWith('body\n')).toBe(true);
    expect(serialized.endsWith('\n\n')).toBe(false); // body 末尾は単一改行
  });
});

describe('quoting / null (MU3)', () => {
  it('日本語 summary が往復する', () => {
    const fm = makeFm({ agent_summary: '日本語のサマリーです。改行なし。' });
    const parsed = parseMemo(serializeMemo(fm, 'b'));
    expect(parsed.frontmatter.agent_summary).toBe(fm.agent_summary);
  });

  it('agent_model: null が往復する', () => {
    const fm = makeFm({ source: 'backfill', agent_model: null });
    const serialized = serializeMemo(fm, 'b');
    expect(parseYaml(serialized.slice(4, serialized.indexOf('\n---\n'))).agent_model).toBeNull();
    const parsed = parseMemo(serialized);
    expect(parsed.frontmatter.agent_model).toBeNull();
  });

  it('summary に : や " を含むケースが往復する', () => {
    const tricky = 'key: value, said "hello" — エッジケース';
    const fm = makeFm({ agent_summary: tricky });
    const parsed = parseMemo(serializeMemo(fm, 'b'));
    expect(parsed.frontmatter.agent_summary).toBe(tricky);
  });
});

describe('parseMemo error (MU3)', () => {
  it('frontmatter 区切りが無い入力は throw する', () => {
    expect(() => parseMemo('frontmatter なしの本文だけ')).toThrow();
  });

  it('開始 --- はあるが閉じ --- が無い入力は throw する', () => {
    expect(() => parseMemo('---\nsource: manual\n本文')).toThrow();
  });
});
