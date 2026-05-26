// 共有型定義 — 全モジュールはここから型をインポートする (単一ソース)。
// type-stripping 互換のため enum / namespace は使わず union + interface のみ。

export type MemoSource = 'manual' | 'backfill';

/**
 * memo Markdown ファイルの frontmatter (v0.1 確定スキーマ, spec §5)。
 * filename は `YYYY/MM/DD-<slug>-<short_id>.md`。
 */
export interface Frontmatter {
  source: MemoSource;
  /** captured_at の `:` を `-` に置換 + `-<short_id>` の filename-safe 派生 */
  source_id: string;
  /** CLI 起動時刻, ISO 8601 (TZ offset 付き) */
  captured_at: string;
  /** `^[a-z0-9-]{1,60}$`, NG は `memo-YYYYMMDD-HHMMSS` fallback */
  slug: string;
  /** crypto.randomBytes(3).toString('hex') = 小文字 hex 6 文字 */
  short_id: string;
  /** v0.1 は hardcode [] */
  tags: string[];
  agent_summary: string;
  /** 生成モデル。backfill 由来は null */
  agent_model: string | null;
  /** 入力 token 上限超過で先頭のみから要約した場合 true */
  truncated: boolean;
  /** M2 の recall delete 用。MCP 検索は true を除外 */
  deleted: boolean;
}

/** `~/.recall/config.json` スキーマ (v0.1, spec §5) */
export interface Config {
  vault_path: string;
  repo_url: string;
  agent_model: string;
  agent_max_input_tokens: number;
  agent_max_output_tokens: number;
  anthropic_api_key_source: 'keychain' | 'env';
  log_path: string;
  pricing: {
    input_per_mtok_usd: number;
    output_per_mtok_usd: number;
  };
}

/**
 * intake (LLM single-shot) の構造化出力。
 * Anthropic SDK の forced tool-use (`save_memo`) の tool input として受け取る。
 * v0.1 MVP では quarantine_reason は記録のみ (quarantine フロー本体は Phase 5)。
 */
export interface SaveMemoInput {
  agent_summary: string;
  slug: string;
  quarantine_reason: string | null;
}

/** MCP `search_memos` が返す 1 件 */
export interface SearchResultItem {
  path: string;
  summary: string;
  source_id: string;
  captured_at: string;
  snippet: string;
}
