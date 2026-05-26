// MI1 — 実 rg を使った search_memos 検索パイプラインの統合テスト。
// fixtures/vault は read-only。searchMemos を直接叩いて rank / deleted 除外 / glob 除外 / limit / timeout を検証する。
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchMemos } from '../../src/search.ts';

// fixtures/vault の絶対パス (このテストファイルからの相対)。
const VAULT_PATH = fileURLToPath(new URL('../fixtures/vault', import.meta.url));

// rg バイナリ解決: PATH 上の rg を which で探す。無ければ環境セットアップ不備として明示 fail。
function resolveRgPath(): string {
  try {
    return execFileSync('which', ['rg'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

let RG_PATH = '';

beforeAll(() => {
  RG_PATH = resolveRgPath();
});

describe('searchMemos (integration, 実 rg)', () => {
  it('rg が PATH 上に存在する (環境前提)', () => {
    expect(RG_PATH, 'rg が PATH 上に見つかりません。`brew install ripgrep` が必要です。').not.toBe('');
  });

  it('agent_summary ヒットが body のみヒットより上位に来る (tier ランク)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    // summary-hit 3 件 + body-only-hit 1 件 = 4 件 (deleted / .recall / paraphrase は除外)。
    expect(results.length).toBe(4);

    // body のみヒットのメモ (api-perf-notes) は最後尾に来る。
    const bodyOnly = results[results.length - 1];
    expect(bodyOnly?.path).toContain('api-perf-notes');

    // 先頭 3 件は summary に 'prompt caching' を含む (summary-hit tier)。
    for (const r of results.slice(0, 3)) {
      expect(r.summary.toLowerCase()).toContain('prompt caching');
    }
  });

  it('同 tier 内は captured_at 降順 (新しい順) で tie-break される', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    // summary-hit 3 件は 2026-05-20 > 2026-05-10 > 2026-01-15 の順。
    expect(results[0]?.path).toContain('prompt-caching-ttl'); // 05-20
    expect(results[1]?.path).toContain('bilingual-caching'); // 05-10
    expect(results[2]?.path).toContain('prompt-caching-cost'); // 01-15
  });

  it('deleted:true のメモは結果に出ない', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    expect(results.some((r) => r.path.includes('deleted-prompt-caching'))).toBe(false);
    expect(results.some((r) => r.summary.includes('削除済み'))).toBe(false);
  });

  it('.recall 配下はヒットしない (glob 除外)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    expect(results.some((r) => r.path.includes('.recall'))).toBe(false);
  });

  it('paraphrase (言い換え) のみのメモは substring 検索で引っかからない (finding H)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    expect(results.some((r) => r.path.includes('response-cache-paraphrase'))).toBe(false);
  });

  it('limit が守られる (limit=2 で 2 件)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, limit: 2, rgPath: RG_PATH });
    expect(results.length).toBe(2);
    // 上位 2 件 = summary-hit の最新 2 件。
    expect(results[0]?.path).toContain('prompt-caching-ttl');
    expect(results[1]?.path).toContain('bilingual-caching');
  });

  it('limit 未指定なら default (5) 件まで (今回は該当 4 件なので 4)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBe(4);
  });

  it('返却 item が必要フィールドを持つ (path は vault 相対)', async () => {
    const results = await searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    const top = results[0];
    expect(top).toBeDefined();
    if (!top) return;
    expect(top.path.startsWith('/')).toBe(false); // 絶対パスでない (相対)。
    expect(top.path).toMatch(/\.md$/);
    expect(typeof top.summary).toBe('string');
    expect(typeof top.source_id).toBe('string');
    expect(typeof top.captured_at).toBe('string');
    expect(typeof top.snippet).toBe('string');
    expect(top.snippet.length).toBeGreaterThan(0);
  });

  it('rgTimeoutMs を渡しても例外を投げずに返る (1s NFR 担保)', async () => {
    // timeout を指定しても落ちないこと (厳密な時間計測はしない)。
    await expect(
      searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH, rgTimeoutMs: 750 }),
    ).resolves.toBeInstanceOf(Array);
    // 極端に短い timeout でも例外なく配列 (空 or 部分) を返す。
    await expect(
      searchMemos({ query: 'prompt caching', vaultPath: VAULT_PATH, rgPath: RG_PATH, rgTimeoutMs: 1 }),
    ).resolves.toBeInstanceOf(Array);
  });

  it('マッチ無しの query で空配列 (rg exit 1 を握る)', async () => {
    const results = await searchMemos({
      query: 'this-string-definitely-does-not-exist-anywhere-xyz123',
      vaultPath: VAULT_PATH,
      rgPath: RG_PATH,
    });
    expect(results).toEqual([]);
  });

  it('空 query は空配列', async () => {
    const results = await searchMemos({ query: '', vaultPath: VAULT_PATH, rgPath: RG_PATH });
    expect(results).toEqual([]);
  });
});
