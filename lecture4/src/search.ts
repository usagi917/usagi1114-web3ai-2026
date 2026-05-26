// ripgrep ベースの memo 検索 + ランク付け (T3.2 / ENG E4 / MI1)。
// rg だけではランクできないので「rg で候補抽出 → frontmatter parse → 分類/ランク」の明示パイプライン。
// 日本語は tokenize せず exact substring (--fixed-strings) で引く。paraphrase miss は想定内 (finding H)。
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { SearchResultItem } from './types.ts';
import { parseMemo } from './core/frontmatter.ts';
import { SEARCH_MEMOS_DEFAULT_LIMIT } from './toolDescription.ts';

/** rg --json の match 行から取り出す最小情報。候補ファイルパスと最初のヒット行テキスト。 */
interface RgCandidate {
  /** 絶対パス (rg が出力する path)。 */
  absPath: string;
  /** 最初にヒットした行のテキスト (snippet の素材)。 */
  matchLine: string;
}

/** 候補ファイルの上限 (NFR 1s 担保のため frontmatter parse 対象を抑える)。 */
const CANDIDATE_CAP = 50;
/** rg timeout の既定値 (全体 1s NFR を担保するため検索本体は 750ms)。 */
const DEFAULT_RG_TIMEOUT_MS = 750;
/** body のみヒット時の snippet 既定長。 */
const BODY_SNIPPET_CHARS = 120;

export interface SearchMemosParams {
  query: string;
  limit?: number;
  vaultPath: string;
  /** テスト/環境差異向けに rg バイナリを上書き可能 (既定 PATH 上の 'rg')。 */
  rgPath?: string;
  /** rg の timeout (ms)。既定 750ms。 */
  rgTimeoutMs?: number;
}

/** rg を実行し、stdout (--json) を返す。マッチ無し (exit 1) / timeout は空文字へ穏当にフォールバック。 */
function runRg(query: string, vaultPath: string, rgPath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // shell 補間禁止: execFile の argv 配列で渡す。`--` で query を positional に固定。
    const args = [
      '--json',
      '--fixed-strings',
      '--glob',
      '*.md',
      '--glob',
      '!.recall/**',
      '--glob',
      '!.git/**',
      '--glob',
      '!**/*.tmp',
      '--',
      query,
      vaultPath,
    ];
    execFile(
      rgPath,
      args,
      { signal: controller.signal, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        clearTimeout(timer);
        // rg は「マッチ無し」を exit code 1 で返す。timeout/abort も含め、
        // 受け取れた stdout (部分結果) をそのまま使い、エラーは握り潰す。
        if (error) {
          resolve(typeof stdout === 'string' ? stdout : '');
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** rg --json の stdout をパースして候補 (path + 最初のヒット行) に集約・dedupe する。上位 CANDIDATE_CAP 件。 */
function parseRgJson(stdout: string): RgCandidate[] {
  const order: string[] = [];
  const byPath = new Map<string, RgCandidate>();
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // 壊れた行はスキップ。
    }
    if (typeof evt !== 'object' || evt === null) continue;
    const rec = evt as { type?: unknown; data?: unknown };
    if (rec.type !== 'match') continue;
    const data = rec.data as
      | { path?: { text?: unknown }; lines?: { text?: unknown } }
      | undefined;
    const absPath = data?.path?.text;
    if (typeof absPath !== 'string') continue;
    if (!byPath.has(absPath)) {
      if (order.length >= CANDIDATE_CAP) continue; // cap 到達後は新規 path を取らない。
      const lineText = typeof data?.lines?.text === 'string' ? data.lines.text : '';
      byPath.set(absPath, { absPath, matchLine: lineText.replace(/\r?\n$/, '') });
      order.push(absPath);
    }
  }
  return order.map((p) => byPath.get(p)!);
}

/** ランク用に分類済みの 1 件。tier 0 = summary-hit (優先), tier 1 = body-hit。 */
interface RankedItem {
  tier: 0 | 1;
  /** captured_at の降順 tie-break 用。 */
  capturedAt: string;
  item: SearchResultItem;
}

/** captured_at の降順比較 (新しい順)。文字列 ISO8601 を素直に比較。 */
function byCapturedAtDesc(a: RankedItem, b: RankedItem): number {
  if (a.capturedAt < b.capturedAt) return 1;
  if (a.capturedAt > b.capturedAt) return -1;
  return 0;
}

/**
 * memo vault を検索しランク付けして返す。
 * 1. rg で候補抽出 (glob 除外 + timeout)
 * 2. frontmatter parse + deleted 除外
 * 3. agent_summary ヒット (tier0) / body のみヒット (tier1) に分類, 同 tier は captured_at 降順
 * 4. limit 件で truncate
 */
export async function searchMemos(params: SearchMemosParams): Promise<SearchResultItem[]> {
  const { query, vaultPath } = params;
  const limit = params.limit ?? SEARCH_MEMOS_DEFAULT_LIMIT;
  const rgPath = params.rgPath ?? 'rg';
  const timeoutMs = params.rgTimeoutMs ?? DEFAULT_RG_TIMEOUT_MS;

  // 空 query は rg がエラーになるので早期 return。
  if (query === '') return [];

  const stdout = await runRg(query, vaultPath, rgPath, timeoutMs);
  const candidates = parseRgJson(stdout);
  if (candidates.length === 0) return [];

  const needle = query.toLowerCase(); // case-insensitive substring 判定用。
  const ranked: RankedItem[] = [];

  for (const cand of candidates) {
    let content: string;
    try {
      content = await readFile(cand.absPath, 'utf8');
    } catch {
      continue; // 読めないファイルはスキップ。
    }
    let parsed: ReturnType<typeof parseMemo>;
    try {
      parsed = parseMemo(content);
    } catch {
      continue; // frontmatter 不正はスキップ。
    }
    const { frontmatter, body } = parsed;

    // deleted は content フィルタなので glob では消せない。parse 後に必ず除外する。
    if (frontmatter.deleted === true) continue;

    const summary = frontmatter.agent_summary ?? '';
    const summaryHit = summary.toLowerCase().includes(needle);

    // snippet: ヒット行があればそれを、無ければ body 先頭 ~120 文字。
    const snippet =
      cand.matchLine.trim() !== ''
        ? cand.matchLine.trim()
        : body.slice(0, BODY_SNIPPET_CHARS).trim();

    const item: SearchResultItem = {
      path: relative(vaultPath, cand.absPath),
      summary,
      source_id: frontmatter.source_id,
      captured_at: frontmatter.captured_at,
      snippet,
    };
    ranked.push({ tier: summaryHit ? 0 : 1, capturedAt: frontmatter.captured_at, item });
  }

  // tier 昇順 (summary-hit 優先) → 同 tier は captured_at 降順。
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return byCapturedAtDesc(a, b);
  });

  return ranked.slice(0, limit).map((r) => r.item);
}
