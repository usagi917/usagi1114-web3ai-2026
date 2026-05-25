# Recall v0.1 MVP タスクチェックリスト (task.md)

TDD: 各機能は **Red (テスト作成) → Green (実装) → Refactor** の順。
進捗は完了時に即 `- [x]` へ更新する。

## Phase 0 — 環境・前提確定 (Day 0)

- [ ] T0.1 `npm view @anthropic-ai/sdk version` → `plans/sdk-versions.md` に記録
- [ ] T0.2 Sonnet 4.6 実価格確認 (Anthropic console)、試算とのズレ確認
- [ ] T0.3 `which rg` 確認 (不在なら `brew install ripgrep`)
- [ ] T0.4 `gh repo create memo-vault --private` + SSH key 確認
- [ ] T0.5 Backfill seed 20-30 メモ (frontmatter スキーマ、`agent_model: null`)
- [ ] T0.6 `ANTHROPIC_API_KEY` を Keychain 登録
- [ ] T0.7 ★ search_memos description v1 を behavioral に書く (候補2つ→1つ凍結, DX1)。stub に持ち込む前に

## Phase 0.5 — H2 先行検証 stub (Day 0-1, Phase 1 と並行) ★premise gate

- [ ] T0.5a dumb MCP stub (tool name/description/inputSchema を本物と同一固定)
- [ ] T0.5b Claude Code に繋ぎ、実作業で 5 質問 → unprompted 発火を観察
- [ ] T0.5c 判定 (弱ければ handoff pivot を Phase 3 init 設計に反映)

## Phase 1 — recall add thin slice (Day 1-2, Phase 0.5 と並行)

- [ ] T1.1 CLI skeleton (TypeScript + pnpm、サブコマンド分岐)
- [ ] **Red** MU1 slug validation テスト
- [ ] **Red** MU2 short_id テスト **+ 衝突 existence-check リトライ** (ENG E1)
- [ ] **Red** MU3 frontmatter シリアライズテスト (日本語 YAML)
- [ ] **Red** MU4 min redaction テスト
- [ ] **Red** MA1 intake mock (正常 / timeout 8s / 5xx **+ max_tokens 切断 / tool_use 不在**, ENG E2)
- [ ] **Red** ★ MI0 e2e (mock intake + temp git + failing push) (ENG E3)
- [ ] **Green** T1.0 入力ガード (empty reject / 巨大 truncate, ENG E9)
- [ ] **Green** T1.2 intake + `parseSaveMemoToolUse` 厳密 validate
- [ ] **Green** T1.3 hard timeout 8s (`maxRetries:0, timeout:8000`, ENG E10)
- [ ] **Green** T1.4 min redaction (api key mask)
- [ ] **Green** T1.5 wrapper + short_id existence-check リトライ
- [ ] **Green** T1.6 file write (同一 FS `.tmp` + rename, ENG E11)
- [ ] **Green** T1.7 git `execFile` + `commit --only -- <file>` (ENG E5), push は別計測
- [ ] **Green** T1.8 intake 失敗時 `failed-add.log` (raw を stderr に出さない, ENG E7)
- [ ] **Green** T1.9 error message contract (what/why/status/fix + missing-API-key pre-flight, DX4)
- [ ] **Refactor** Phase 1 整理

## Phase 2 — ロギング・計測 (Day 3-4)

- [ ] T2.1 `recall.jsonl` 最小 event log (cost_usd/pricing は Phase 5 へ defer, CEO E)
- [ ] T2.3 レイテンシ計測 (commit まで 3 秒以内、超えたら output_tokens 256)
- [ ] T2.4 push を intake/commit と別計測 (CEO G)

## Phase 3 — MCP server + recall init (Day 5-6)

- [ ] **Red** MU5 mcp.json merge テスト (新規 / 他 server 保持 / idempotent / **不正 JSON abort**)
- [ ] **Red** MI1 search_memos テスト (agent_summary 優先 / deleted 除外 / .recall 除外 / **cap + rg timeout**)
- [ ] **Green** T3.1 `recall mcp serve` (config 読み込み)
- [ ] **Green** T3.2 search_memos (rg→parse top-N→filter deleted→rank, ENG E4)
- [ ] **Green** T3.3 `recall init` (依存チェック + config 生成 + mcp.json merge + 不正 JSON abort, ENG E8)
- [ ] **Green** T3.4 `~/.recall/logs/` mkdir -p
- [ ] **Green** T3.4b served-snippets 最小 logger (results_count>0 で append, CEO D)
- [ ] **Green** T3.4c init 末尾 self-check + smoke test + blocking restart message (DX2/3)
- [ ] T3.5 再起動後「どんな tool ある?」で registered 確認 → 呼び出し確認 (registered と called を分離, DX3)
- [ ] **Refactor** Phase 3 整理 + stub→本物 server 移植 (schema verbatim, ENG E6)

## Phase 4 — 検証 eval (Day 7)

- [ ] **Red/E2E** ME1 MCP tool-call rate eval (10 クエリ事前定義, 期待 memo id を pre-register, CEO C)
- [ ] T4.1 tool-call rate 合格判定 (backfill 6 中 ≥3 + target ヒット、control 4 中 ≤1、≥2/5 を語彙非一致, CEO B/C)
- [ ] T4.1b served-snippets.jsonl から organic distinct query baseline (CEO D)
- [ ] T4.2 A/B eval (pre-registered target ヒットを一次、回答品質は二次)
- [ ] T4.3 `lectures/lecture3/m1-validation.md` に検証ログ commit

## Phase 5+ — 防御系ハードニング (M2、検証成功後)

- [ ] T5.1 Content safety gate フル版 (redaction 5 ルール + gitleaks + quarantine)
- [ ] T5.2 atomic write (tmp + rename)
- [ ] T5.3 async detached push + pending queue + rename-claim
- [ ] T5.4 exit code 5 種 + quarantine reason
- [ ] T5.5 24 test path フルセット
- [ ] T5.6 served-snippets.jsonl + rotation
- [ ] T5.7 recall delete/edit/list/quarantine
