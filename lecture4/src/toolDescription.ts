// search_memos の tool 定義 — H2 (Claude Code が自発的に呼ぶか) を駆動する一級成果物 (DX1)。
// stub (Phase 0.5) と本物の MCP server (Phase 3) は name / description を verbatim で共有する (ENG E6)。
// 書き換えるときは「両方が同じものを参照する」ことを壊さないこと。

export const SEARCH_MEMOS_NAME = 'search_memos';

/**
 * behavioral description v1 (plan §4)。
 * substring (ripgrep) ベースなので semantic recall を over-promise しない。
 */
export const SEARCH_MEMOS_DESCRIPTION = [
  '開発者個人のローカル memo vault を検索する。',
  '呼ぶべきとき: ユーザーが過去の決定・調査結果・覚えていたエラー・設定値・プロジェクト文脈・実装メモ、または「以前何を決めた/学んだ?」を尋ねたとき。',
  'キーワード/エラーメッセージ/具体的な語での検索が最も効く (完全一致〜近似一致ベース)。',
  '呼ばない: 一般知識・時事・vault に無いと分かっている話題。',
].join('\n');

/** inputSchema の意図 (MCP server 側で zod に落とす際の参照) */
export const SEARCH_MEMOS_INPUT_DOC = {
  query: 'string — 要件/テーマ/エラーメッセージ等',
  limit: 'number — default 5',
} as const;

export const SEARCH_MEMOS_DEFAULT_LIMIT = 5;
