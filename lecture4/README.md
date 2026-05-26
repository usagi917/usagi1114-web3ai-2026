# Recall v0.1 MVP — 第4回

ローカル memo vault に開発メモを保存し、**Claude Code から MCP 経由で過去メモを検索**できる CLI ツール。
`lectures/lecture3/spec.md`(v6 フル設計)を `plans/plan.md`(ビルド順序の正)に従い **MVP 3 機能**に絞って実装したもの。

## MVP の 3 機能

| コマンド | 役割 |
|---|---|
| `recall add "本文"` | 本文を LLM single-shot で要約・slug 化し、frontmatter 付き Markdown を vault に commit |
| `recall mcp serve` | Claude Code が起動する MCP server。`search_memos(query)` を提供 (ripgrep ベース) |
| `recall init` | セットアップ。config 生成 / `~/.claude/mcp.json` merge / 依存チェック / self-check |

検証する 3 仮説: **H1** intake が要約+slug の JSON を生成し commit できる / **H2** Claude Code が過去メモ関連の質問で *自発的に* `search_memos` を呼ぶ / **H3** ripgrep 検索結果が回答の context として効く(exact/near-exact recall に限定。paraphrase miss は想定内 = semantic index が必要という証拠)。

## アーキテクチャ (MVP パイプライン)

```
recall add "本文"
  → 入力ガード (空 reject / 巨大 truncate)
  → 最小 redaction (api key 形式 1 ルール)
  → intake: LLM single-shot (forced tool-use JSON {agent_summary, slug}, hard timeout 8s)
  → wrapper (frontmatter + body 組み立て, slug validation, short_id 衝突チェック)
  → atomic write (同一 FS .tmp + rename)  →  YYYY/MM/DD-<slug>-<short_id>.md
  → git add + commit (path-scoped, 同期)  →  push (失敗しても intake 成功は汚さない)

recall mcp serve  (Claude Code が spawn)
  → search_memos(query, limit)
  → ripgrep (--json --fixed-strings, .recall/** .git/** *.tmp 除外, 750ms timeout)
  → 候補 cap 50 → frontmatter parse → deleted 除外
  → rank (agent_summary ヒット > body ヒット > captured_at desc)
  → 上位 N 件 [{path, summary, source_id, captured_at, snippet}]
```

唯一の working tree は `~/.recall/memo-vault`。`add` も `mcp serve` も同じ tree を読む。

## セットアップ (TTHW 目標 ~10 分)

前提: macOS / Node >= 22 / pnpm / git。

```bash
# 1. 依存バイナリ
brew install ripgrep                       # 検索エンジン (必須)

# 2. memo-vault の private repo (任意だが push 学習目標)
gh repo create memo-vault --private        # SSH key 設定済みであること

# 3. このパッケージを install + グローバルリンク
cd lectures/lecture4   # (このディレクトリ)
pnpm install
pnpm link --global                         # `recall` を PATH に通す

# 4. Anthropic API キーを Keychain に登録
security add-generic-password -s recall -a ANTHROPIC_API_KEY -w <your-api-key>
#   (または環境変数 ANTHROPIC_API_KEY を使う)

# 5. 初期化 (config / mcp.json / self-check)
recall init

# 6. Claude Code を再起動  ← MCP server は起動時に 1 回しか config を読まない

# 7. smoke test
recall add "Recall smoke test: prompt caching は 5 分 TTL"
#   → Claude Code で「保存した smoke test メモは?」と聞き search_memos の発火を確認
```

`recall init` は末尾に self-check を出す: `rg` / API キーが**実際に読めるか** / `recall` 絶対パスの実行可否 / vault が git repo か。
silent な落とし穴(PATH / keychain / 再起動忘れ)を runtime 前に潰すため。

## 使い方

```bash
recall add "本文をそのまま"          # positional 引数
pbpaste | recall add                  # stdin (DX6)
recall --help                         # human commands と mcp serve を分けて表示
```

失敗時は全コマンドが統一フォーマットで出す (DX4):

```
Error: <何が>
Cause: <なぜ>
Memo status: <どこに保存 / 未保存>
Fix: <次の 1 コマンド or 行動>
```

## スキーマ

**Frontmatter** (`tests/fixtures/vault/**` が実例):

```yaml
source: manual            # manual | backfill
source_id: 2026-05-22T10-32-00-aaaaaa
captured_at: 2026-05-22T10:32:00+09:00
slug: prompt-caching-ttl  # ^[a-z0-9-]{1,60}$, NG は memo-YYYYMMDD-HHMMSS
short_id: aaaaaa          # crypto.randomBytes(3).toString('hex')
tags: []
agent_summary: "..."
agent_model: claude-sonnet-4-6   # backfill 由来は null
truncated: false
deleted: false
```

**config** は `~/.recall/config.json` (`recall init` が生成)。価格は暫定 input $3 / output $15 per MTok (cost 計算自体は Phase 5 へ defer)。

## テスト

```bash
pnpm test         # vitest, 11 files / 81 tests
pnpm typecheck    # tsc --noEmit
```

| テスト | 対象 | 種別 |
|---|---|---|
| MU1 | slug validation (OK/NG/fallback) | unit |
| MU2 | short_id 生成 + **衝突 existence-check リトライ** (ENG E1) | unit |
| MU3 | frontmatter シリアライズ往復 (日本語 YAML / null) | unit |
| MU4 | 最小 redaction (api key mask) | unit |
| MA1 | intake mock (正常 / timeout 8s / 5xx / max_tokens 切断 / tool_use 不在) | unit |
| **MI0** | **`recall add` e2e** (mock intake + temp git + failing push): exit 0 / .md 1個 / commit 範囲 / push 失敗の隔離 (ENG E3) | integration |
| MU5 | mcp.json merge (新規 / 他 server 保持 / idempotent / 不正 JSON abort) | unit |
| MI1 | `search_memos` (summary 優先 / deleted 除外 / .recall 除外 / cap+timeout) | integration |

## 実装の要点 (レビュー由来の防御)

- **データ消失防止**: short_id 書き込み前 existence-check (ENG E1) + atomic .tmp+rename 同一 FS (ENG E11)。
- **intake 厳密 validation**: forced tool-use でも tool_use ちょうど1個 / `max_tokens` 切断 reject / schema 検証 (ENG E2)。8s hard timeout は `maxRetries:0, timeout:8000` 併用で SDK 自動 retry が予算を食うのを防ぐ (ENG E10)。
- **機微 leak 防止**: intake 失敗時 raw を stderr に出さず `~/.recall/failed-add.log` (gitignore) へ (ENG E7)。
- **他ツール破壊防止**: `mcp.json` が不正 JSON なら abort、上書きしない (ENG E8)。他 server entry は保持。
- **MCP ランク**: rg だけではランク不可なので rg → parse top-N → deleted filter → rank の明示パイプライン + 750ms timeout で 1s NFR (ENG E4)。
- **tool description は一級成果物** (DX1): `src/toolDescription.ts` に behavioral な v1 を置き、(将来の stub と) 本物 server が verbatim 共有 (ENG E6)。H2 を駆動する主独立変数。

## スコープ外 (Phase 5+ へ defer)

content safety gate フル版 (redaction 5 ルール + gitleaks + quarantine) / async detached push + pending queue / exit code 5 種 / 24 test path フルセット / served-snippets rotation / `recall delete/edit/list` / Notion 同期 / Curator Agent / sqlite-vec。詳細は `plans/plan.md` §1, §3 Phase5+。

## 関連

- `plans/plan.md` — MVP 実装プラン (ビルド順序の正、/autoplan レビュー済み)
- `plans/task.md` — TDD チェックリスト
- `plans/sdk-versions.md` — SDK/ツール確定版
- `lectures/lecture3/spec.md` — v6 フル設計 (全体構想)
