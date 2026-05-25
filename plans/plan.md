<!-- /autoplan restore point: ~/.gstack/projects/usagi917-usagi1114-web3ai-2026/main-autoplan-restore-20260526-074757.md -->
# Recall v0.1 MVP 実装プラン (plan.md)

> **位置づけ**: このファイルが **ビルド順序の正**。`lectures/lecture3/spec.md` は全体構想 (v6 フル設計)。
> 両者がズレたら **この plan のビルド順序を優先**する (spec.md 冒頭の注記に従う)。
> MVP スライス = **3 機能**: `recall add` / smart search MCP / `recall init`。
> spec で「v0.1 必須」と書かれた防御系 (content safety gate / atomic write / async push + pending queue / 24 test path / exit code 5 種) は **後続フェーズ (Phase 5+)** で積む。

---

## 0. ゴールと検証する仮説

このプロトタイプで検証したい **最も不確実な 3 つの仮説**:

1. **H1 (intake)**: `recall add` が LLM single-shot で本文を要約・slug 化し、frontmatter 付き Markdown を `~/.recall/memo-vault` に正しく commit できる
2. **H2 (MCP)**: Claude Code が、過去メモに関連する質問をしたとき **本当に** MCP `search_memos` を自発的に呼ぶ
3. **H3 (relevance)**: ripgrep ベースの検索結果が、回答の context として実際に効く

**規準 (今週末 2026-05-28 まで)**: H1〜H3 が end-to-end で動けば MVP は検証成功。動かなければ §6 の切り分け順で対処。

**検証順序 (premise gate 決定: 並行)**: H2 は最も不確実なので **Day 0-1 に dumb MCP stub を seeded vault に当てて先行検証**しつつ、`recall add` の構築も並行で進める。H2 が早期に死んだら handoff モデル (explicit `@recall` 言及 / CLAUDE.md ルール) を pivot し、capture pipeline への投資を絞る。

**H3 の主張範囲 (CEO finding H)**: ripgrep は **exact / near-exact な textual recall** を検証する手段。「どう書いたか忘れたメモを paraphrase で見つける」は検証対象外。paraphrase クエリで relevance が落ちるのは **バグではなく、semantic index (v0.5 sqlite-vec) が必要という証拠**として記録する。

---

## 1. スコープ

### IN (MVP / Phase 0-4)

| ID | 機能 | MVP での割り切り |
|---|---|---|
| F1 | `recall add` CLI (LLM single-shot intake) | tool-use forced JSON で `{agent_summary, slug}` 生成、body 非再生成。**push は同期** (async + pending queue は Phase 5)。redaction は **最小** (api key 形式 1 ルール) のみ、フル redaction は Phase 5 |
| F2 | memo-vault commit & push | `YYYY/MM/DD-<slug>-<short_id>.md`、`~/.recall/memo-vault` を唯一の working tree。**MVP は通常 write → git add → commit → push (同期)**。atomic rename (tmp+rename) は Phase 5 |
| F4 | smart search MCP (`recall mcp serve`) | `search_memos(query)` = ripgrep のみ、`agent_summary` + body 検索。`.recall/**` `.git/**` 除外。1 秒以内 |
| INIT | `recall init` | `~/.recall/config.json` 生成 + `~/.claude/mcp.json` を **merge** (他 server 保持) + 依存バイナリ (`rg`) チェック |

### NOT IN — Phase 5+ へ defer (spec では v0.1 必須だが MVP では削る)

- **F3 Content safety gate フル版** (pre-flight redaction 5 ルール + gitleaks post-flight + quarantine フロー)。MVP は api key 形式の単一 redaction のみ
- **atomic write** (`.recall/tmp/<uuid>.md` → `rename(2)`)
- **async detached push** (`spawn(detached).unref()`) + **pending queue** (`.recall/pending/`) + race-safe rename-claim
- **exit code 5 種規約** (0/1/2/3/4)。MVP は 0=成功 / 1=失敗 の 2 値
- **24 test path フルセット**。MVP は H1-H3 を守る最小テストのみ (§5)
- **観測性フル** (`recall.jsonl` 全フィールド + `served-snippets.jsonl` + rotation)
- `recall delete/edit/list/recent/quarantine` (M2)
- Notion 同期 / Curator Agent / sqlite-vec (v0.5)

### 検索 rerank の扱い (要決定)

- spec v6 §5 = **ripgrep のみ** (LLM rerank なし、1 秒 NFR 最優先)
- → **MVP は spec v6 に従い ripgrep only**。LLM rerank は v0.5 で評価。ランク順は `agent_summary` ヒット優先 → body ヒット → `captured_at desc`

---

## 2. アーキテクチャ概略 (MVP)

```
recall add "本文"
  → [min redaction]          # api key 形式のみ mask (フル版は Phase 5)
  → [intake: LLM single-shot] # forced JSON {agent_summary, slug}, hard timeout 8s
  → [wrapper: frontmatter + body 組み立て]
  → write file (YYYY/MM/DD-<slug>-<short_id>.md)
  → git add + commit + push   # MVP は同期

recall mcp serve  (Claude Code / Cursor が起動)
  → search_memos(query)
  → ripgrep (--glob '!.recall/**' '!.git/**')
  → rank (agent_summary > body > captured_at desc)
  → 上位 N 件 [{path, summary, source_id, captured_at, snippet}]

recall init
  → 依存チェック (which rg)
  → ~/.recall/config.json 生成
  → ~/.claude/mcp.json merge (atomic write, 他 server 保持, 絶対パス)
```

唯一の working tree: `~/.recall/memo-vault`。`recall add` も `recall mcp serve` も同じ tree を読む。

---

## 3. フェーズ構成 (spec §10 の Day 割りに対応)

### Phase 0 — 環境・SDK・前提確定 (Day 0 / 今夜)

- **T0.1** `npm view @anthropic-ai/sdk version` で SDK version 確定 → `plans/sdk-versions.md` に記録
- **T0.2** Anthropic console で Sonnet 4.6 実価格確認 (input/output per MTok)、試算とズレ 2 倍以内なら続行
- **T0.3** 依存バイナリ確認: `which rg` (ripgrep)。不在なら `brew install ripgrep`
- **T0.4** `gh repo create memo-vault --private`、SSH key 設定確認 (`ssh -T git@github.com`)
- **T0.5** Backfill seed: 既存 Notion から手動で 20-30 メモを frontmatter スキーマで作成し commit (`agent_summary` 手書き、`agent_model: null`)。**KPI を week 1 から計測するために必須**。**(CEO finding B) clean なメモばかりにしない** — vague なタイトル / 日英混在 / 同義語 / 古い言い回し / 答えはあるがキーワード非一致、のような "ugly" メモを数件混ぜる。clean な corpus だけだと H3 が confound される
- **T0.6** `ANTHROPIC_API_KEY` を macOS Keychain に登録 (`security add-generic-password`)

### Phase 0.5 — H2 先行検証 stub (Day 0-1、Phase 1 と並行) ★premise gate 決定

- **T0.5a** dumb MCP search stub: seeded vault (T0.5) を ripgrep するだけの最小 `search_memos` を ~1 時間で書く (intake / git / logging 不要)。`@modelcontextprotocol/sdk` の最小 server。**(ENG E6) tool の `name` / `description` / `inputSchema` は本物と同一に固定**し、本物の MCP server (T3.1-T3.2) に verbatim で持ち込む。Claude Code の呼び出し判断は description が駆動するので、ここがズレると H2 の証拠が転移しない。理想は「stub = `recall mcp serve` の search 実装だけ placeholder」
- **T0.5b** Claude Code に stub を繋ぎ、**実作業中に** 5 つの本物の質問をして `search_memos` が **unprompted で発火するか** を観察
- **T0.5c** 判定: 発火が弱ければ H2 危険 → handoff モデル pivot 検討 (description 磨き / explicit `@recall` / CLAUDE.md ルール) を Phase 3 の `recall init` 設計に反映。発火すれば capture pipeline 構築を続行
- この stub は **throwaway**。Phase 3 で本物の MCP server (T3.1-T3.2) に置換

### Phase 1 — `recall add` thin slice (Day 1-2、Phase 0.5 と並行)

- **T1.1** `recall` CLI skeleton (TypeScript + pnpm、サブコマンド分岐: `add` / `mcp serve` / `init`)。単一エントリポイント + サブコマンド (spec §7 の理由による)。**positional 引数が無ければ stdin から読む** (DX6: `pbpaste | recall add` は Day-1 ergonomic)。`recall --help` は human commands (add/init) と Claude Code command (mcp serve) を分けて表示
- **T1.0** 入力ガード (ENG E9): 空/空白のみ入力は API call 前に exit 1 で reject。巨大入力は API 前に `slice()` で先頭 N char に hard truncate (degrade、reject しない)
- **T1.2** intake pure function: `@anthropic-ai/sdk` Messages API + dummy tool `save_memo` + `tool_choice: {type:"tool", name:"save_memo"}` で forced JSON `{agent_summary, slug}`。body は返させない。**`parseSaveMemoToolUse(message)` を pure function で切り出す** (ENG E2): content block を parse、`tool_use` が ちょうど 1 個 `save_memo` であることを要求、`stop_reason: max_tokens`/非 tool stop は reject、`input` を schema validate (summary 長さ含む)
- **T1.3** hard timeout 8s (`AbortController`)。**`messages.create` に `{ signal, maxRetries: 0, timeout: 8000 }`** を渡す (ENG E10): SDK の自動 retry が 8s 予算を食い潰すのを防ぎ「1 試行 8s」を保証。T0.1 で `signal` サポートを version 確認。timeout/network/5xx は失敗扱い (MVP は exit 1、quarantine は Phase 5)
- **T1.4** min redaction: api key 形式の正規表現 1 ルールで入力を mask して `redacted_body` を得る
- **T1.5** wrapper: `frontmatter + redacted_body` 組み立て → slug 形式 validation (`^[a-z0-9-]{1,60}$`、NG は `memo-YYYYMMDD-HHMMSS` fallback) → `short_id` 生成 (`crypto.randomBytes(3).toString('hex')`)。**書き込み前に `fs.existsSync(path)` で衝突チェックし、衝突したら short_id を再生成** (ENG E1: 16M 空間は birthday paradox で 1 年 heavy 使用 ~33%、無チェックだと silent overwrite = データ消失)
- **T1.6** file write `YYYY/MM/DD-<slug>-<short_id>.md`。**1行 atomic rename を残す** (CEO finding F)。**temp file は最終 dir と同一 FS に置く** (ENG E11): `<finaldir>/.<slug>-<short_id>.md.tmp` に write → `fs.renameSync` で最終 path へ。`/tmp`→`~/.recall` のクロス FS rename は copy+unlink に落ちて torn read 復活するので不可。MCP 側は `*.md` のみ検索 + `--glob '!**/*.tmp'` で temp 除外
- **T1.7** `git add -- <file>` + `git commit --only -- <file>` (ENG E5: path-scoped、並行 add の index 混線を防ぐ) → `git push`。**`execFile`/argv で呼ぶ (shell 補間禁止)**、「nothing to commit」(exit 1) を失敗と区別、local commit 成功 = CLI 成功、push 失敗は別 log + remediation text。push は H1-H3 critical path ではない (CEO finding G)
- **T1.8** intake 失敗時のメモ保全 (ENG E7、Claude×Codex 折衷): **raw body を stderr に出さない** (Codex: 失敗した機微テキストの leak)。代わりに `~/.recall/failed-add.log` (gitignore、local 専用) に append。quarantine 機構は Phase 5 のまま
- **T1.9** エラーメッセージ contract (DX4、`recall add` / `recall init` に適用): 全 user-facing 失敗は `Error: <何が> / Cause: <なぜ> / Memo status: <どこに保存/未保存> / Fix: <1 コマンド or 次の行動>` 形式。特に **API key を keychain から読めない場合は API call 前に pre-flight で specific message** (`ANTHROPIC_API_KEY not found in keychain (service=<X>); run: security add-generic-password ...`)。push 失敗時の Fix は `git -C ~/.recall/memo-vault push` を literal 提示

### Phase 2 — ロギング・レイテンシ (Day 3-4)

- **T2.1** `~/.recall/logs/recall.jsonl` 最小 event log (ts, action, slug, agent_latency_ms, commit_latency_ms)。**cost_usd / pricing config は Phase 5 へ defer** (CEO finding E: H1-H3 を検証しない observability 過剰)
- **T2.3** レイテンシ計測 → commit まで 3 秒超なら `agent_max_output_tokens` を 256 に絞る or streaming 検討
- **T2.4** (push 別計測, CEO finding G) push 時間を intake/commit と **分けて** 記録。push 失敗は intake 成功判定を汚さない (local commit が H1-H3 の真の依存)

### Phase 3 — MCP server + `recall init` (Day 5-6)

- **T3.1** `recall mcp serve`: `@modelcontextprotocol/sdk`、起動時に `~/.recall/config.json` から `vault_path` 読む
- **T3.2** `search_memos(query, limit=5)` (ENG E4: ripgrep だけではランク不可、明示パイプライン): `rg --json --fixed-strings --glob '*.md' --glob '!.recall/**' --glob '!.git/**'` で**候補 path を集約 → 上位 N (cap 50) → 各 file の frontmatter を parse** して (a) summary-hit/body-hit 分類 (b) `captured_at` tie-break (c) `deleted: true` 除外 → rank。**`deleted` は content なので glob では消せない、parse 後 filter 必須**。rg subprocess に 700-800ms timeout を巻いて全体 1s NFR を担保。日本語は tokenize しない (exact substring のみ、paraphrase miss は finding H 通り想定内)
- **T3.3** `recall init`: 依存チェック (`which rg`) → `~/.recall/config.json` 作成 → `~/.claude/mcp.json` merge。**JSON.parse は try/catch で包み、不正 JSON なら明確なメッセージで abort (上書き禁止)** (ENG E8: user の他 MCP server を破壊しない)。正常時は deep-equal (parsed object 同士) で idempotent 判定 → 他 server entry 保持 → tmp+rename atomic write → 絶対パス `which recall`
- **T3.4** `~/.recall/logs/` を `mkdir -p`
- **T3.4b** **served-snippets 最小 logger** (CEO finding D): `results_count > 0` のとき `~/.recall/logs/served-snippets.jsonl` に 1 行 append (~30行)。rotation/gzip は Phase 5。**H2 を organic 利用から測る唯一の計器**なので MVP に戻す
- **T3.4c** **`recall init` の末尾 self-check + smoke test** (DX2/3、`recall doctor` 新コマンドは作らず init に畳む): init 完了時に (1) `which rg` OK (2) keychain key が **実際に読めるか** (assume せず read) (3) mcp.json に書いた `recall` 絶対 path が `which recall` と一致 (4) vault が git repo か、を実行して checklist 出力。最後に **blocking 風メッセージ** `Restart Claude Code now. Until restart, search_memos is not available.` + 公式 smoke 手順 (`recall add "Recall smoke test: ..."` → 再起動 → Claude Code に「保存した smoke test メモは?」と聞く)
- **T3.5** Claude Code 再起動 → MCP 認識確認。**「tool が registered か」と「agent が呼んだか」を分離** (DX): 再起動後に Claude Code へ「どんな MCP tool がある?」と聞いて `search_memos` の存在をまず確認してから eval クエリを使う (H2 の誤帰属を防ぐ最重要 step)

### Phase 4 — 検証 eval (Day 7)

- **T4.1** MCP tool-call rate eval: 事前定義 10 クエリ (backfill 系 3 + 抽象 3 + control 4)。合格 = backfill 系 6 件中 ≥ 3 で `search_memos` 呼ばれる、control 4 件で ≤ 1 件。**(CEO finding C) 質問前に期待 memo id を pre-register** し、tool 呼び + 返り値に target memo が含まれて初めて合格 (seed quiz の自己満を防ぐ)。**(finding B) ≥ 2/5 のクエリは memo summary と語彙非一致**にして ripgrep の天井を測る
- **T4.1b** organic 計測 (CEO finding D): T0.5a-c の stub + 本物 MCP の `served-snippets.jsonl` から、実作業での distinct query 数を baseline 記録。staged quiz ではなく organic 利用が H2 の真の指標
- **T4.2** A/B eval: 同じ質問を MCP あり/なしで Claude Code に投げて比較。5 問中 3 問で B が「自分の文脈に合った答え」。**主観判定を避けるため T4.1 の pre-registered target ヒットを一次指標とし、回答品質は二次**
- **T4.3** 検証ログを `lectures/lecture3/m1-validation.md` に貼って commit

### Phase 5+ — 防御系ハードニング (M2 / 2026-06-04 まで)

spec で「v0.1 必須」とされた防御系を **検証成功後に** 積む:

- **T5.1** Content safety gate フル版: redaction-rules.yml 5 ルール + gitleaks post-flight + `.recall/quarantine/<sha>/` 隔離フロー
- **T5.2** atomic write (tmp + rename)
- **T5.3** async detached push + pending queue + race-safe rename-claim
- **T5.4** exit code 5 種 (0/2/3/4/1) + quarantine reason
- **T5.5** 24 test path フルセット (§5)
- **T5.6** `served-snippets.jsonl` + rotation
- **T5.7** `recall delete/edit/list/quarantine`

---

## 4. 確定スキーマ (spec から引用、MVP で使う分のみ)

### Frontmatter (MVP)

```markdown
---
source: manual              # enum: manual | backfill
source_id: 2026-05-22T10-32-00-aaaaaa
captured_at: 2026-05-22T10:32:00+09:00   # ISO 8601
slug: prompt-caching-ttl
short_id: aaaaaa            # crypto.randomBytes(3).toString('hex')
tags: []                    # MVP hardcode
agent_summary: "..."
agent_model: claude-sonnet-4-6 | null
deleted: false
---

（redacted_body をそのまま）
```

### config.json (MVP)

```json
{
  "vault_path": "/Users/usagi1114/.recall/memo-vault",
  "repo_url": "git@github.com:usagi1114/memo-vault.git",
  "agent_model": "claude-sonnet-4-6",
  "agent_max_input_tokens": 8000,
  "agent_max_output_tokens": 512,
  "anthropic_api_key_source": "keychain",
  "log_path": "/Users/usagi1114/.recall/logs/recall.jsonl",
  "pricing": { "input_per_mtok_usd": 3.0, "output_per_mtok_usd": 15.0 }
}
```

### `search_memos` tool description (v1、★H2 を駆動する一級成果物 / DX 最重要)

Claude Code が tool を呼ぶか否かは **description が駆動する**。これは Day-7 fallback ではなく **Day 0 に意図的に書く一級 artifact**。generic な「過去の自分のメモから関連するものを検索する」では弱い。**behavioral (いつ呼ぶ / いつ呼ばない) に書く**。substring (ripgrep) なので semantic recall を over-promise しない:

```
name: search_memos
description: |
  開発者個人のローカル memo vault を検索する。
  呼ぶべきとき: ユーザーが過去の決定・調査結果・覚えていたエラー・設定値・
    プロジェクト文脈・実装メモ、または「以前何を決めた/学んだ?」を尋ねたとき。
  キーワード/エラーメッセージ/具体的な語での検索が最も効く (完全一致〜近似一致ベース)。
  呼ばない: 一般知識・時事・vault に無いと分かっている話題。
inputSchema: { query: string (要件/テーマ/エラーメッセージ等), limit: number (default 5) }
```

- **Day 0**: 候補 description を 2 つ書く (15 分) → 1 つを stub に凍結 (T0.5a)
- **acceptance (DX, fallback ではなく)**: 5 つの organic prompt で「正しい unprompted 呼び出しが少しは出る + 明白な false-positive パターンが無い」を満たして初めて v1 凍結
- 弱ければ **最初のレバーは description 書き換え** (H2 を死んだと結論する前に)

---

## 5. テスト計画 (MVP 最小、TDD: Red→Green→Refactor)

24 path フルセットは Phase 5。MVP では **H1-H3 を守る最小 unit/integration** のみ:

| # | 対象 | 種別 | フェーズ |
|---|---|---|---|
| MU1 | slug validation (OK / NG / fallback) | unit | Phase 1 |
| MU2 | short_id 生成 (hex 6 char) **+ 衝突時の existence-check リトライ** (ENG E1) | unit | Phase 1 |
| MU3 | frontmatter シリアライズ (null 許容、日本語 YAML quoting) | unit | Phase 1 |
| MU4 | min redaction (api key mask) | unit | Phase 1 |
| MA1 | Anthropic SDK mock: 正常 JSON / timeout 8s / 5xx **+ max_tokens 切断 / tool_use 不在** (ENG E2: `parseSaveMemoToolUse` を厳密 validate) | unit (mock) | Phase 1 |
| **MI0** | **★ end-to-end `recall add` (mock intake + temp git repo + failing push): exit 成功 / .md 1個生成 / frontmatter parse / commit はその file のみ / push 失敗は warning で intake 成功を汚さない** (ENG E3, 両モデルが最重要欠落と指摘) | integration | Phase 1 |
| MU5 | mcp.json merge (新規 / 他 server 保持 / idempotent **+ 不正 JSON は abort で上書きしない**, ENG E8) | unit | Phase 3 |
| MI1 | MCP `search_memos`: agent_summary 優先 / deleted 除外 / .recall 除外 / **候補 cap + rg timeout で 1s NFR** (ENG E4) | integration | Phase 3 |
| ME1 | Day 7 MCP tool-call rate eval | e2e | Phase 4 |

**CRITICAL**: MA1 (intake error path) + **MI0 (write→commit→search seam)** は実装と同タイミングで書く。MA1 は LLM 失敗軸、MI0 は H1→H3 の継ぎ目をカバー。**注意**: MA1 単独では silent loss を防げない (ENG E1 の collision-overwrite は exit-0 のデータ消失パス) → MU2 の existence-check とセットで初めて「silent loss なし」が真になる。

---

## 6. リスクと撤退ライン

| リスク | MVP 対応 |
|---|---|
| SDK package/version | T0.1 で `npm view` 確定 |
| Sonnet 4.6 価格ズレ | T0.2、2 倍以内なら続行 |
| MCP が `search_memos` を呼ばない | T4.1 eval、失敗なら description 磨き → CLAUDE.md ルール追記 |
| commit/push 失敗 | local commit 成功 = CLI 成功、push 失敗は別 log + 手動 retry コマンド提示 (DX) |
| intake 失敗でメモ消失 | **exit 1 + raw を `~/.recall/failed-add.log` (gitignore) に保存、stderr には body を出さず location + error class のみ** (ENG E7 / DX5、T1.8 と一致)。quarantine 機構は Phase 5 |
| 検索精度低い | `agent_summary` を grep ターゲットに集中、v0.5 で sqlite-vec。paraphrase miss は finding H 通り想定内 |

**動かなければの切り分け順** (spec §10 より): (a) intake JSON 壊れる→schema validation (b) commit/push 失敗→SSH 確認 (c) MCP 認識されない→mcp.json 確認 (d) 認識されるが呼ばれない→description 磨き (e) 呼ばれるが結果貧弱→agent_summary 質向上

**撤退ライン**: Day 7 で backfill 系 tool-call rate < 50% かつ description 磨きで改善せず → handoff モデル再考。

---

## 7. レビュー記録 (/autoplan)

### Phase 1 — CEO Review (dual voices)

**CEO DUAL VOICES — CONSENSUS TABLE**

| # | Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|---|
| 1 | Premises valid? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — H2 (auto-call) は fragile な assumed premise、H3 は keyword-aligned recall でのみ valid |
| 2 | Right problem? | YES | YES (auto-context を先に検証する条件付き) | **CONFIRMED YES** |
| 3 | Scope calibration correct? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — defer 判断は優秀だが、riskiest test の前に setup/logging が多すぎる |
| 4 | Alternatives explored? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — 「dumb MCP stub を seeded vault に当てて H2 を先に検証」が未検討 |
| 5 | Competitive/market risk? | YES (low) | YES (native memory が吸収しうる) | **CONFIRMED low**、ただし native memory 競合は記録 |
| 6 | 6-month trajectory sound? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — 最も危険な H2 を最後に検証 = regret シナリオ |

**両モデル独立合意の最重要 finding (CROSS-MODEL CONSENSUS)**:
> **シーケンスが逆。H2 (Claude Code が本当に MCP tool を自発呼びするか) が最も不確実なのに Day 7 で最後に検証している。先に dumb MCP stub を seeded vault に当てて H2 を検証 (Day 0-1) → 生き残ったら `recall add` を作る。スコープ追加ゼロ、むしろ数日短縮。**

**CEO findings (severity 付き)**:

| # | Finding | Severity | 出所 | 対応 |
|---|---|---|---|---|
| A | H2 を最後に検証 = regret。dumb MCP stub で先に検証 | **HIGH** | 両モデル | → premise gate で決定 (§下) |
| B | Day 7 eval が seed set で gameable (clean な backfill のみ) | **HIGH** | 両モデル | T0.5 に ugly/paraphrase/bilingual メモ追加、T4.2 で ≥2/5 を非語彙一致クエリに |
| C | 成功指標が主観的 ("5問中3問") | HIGH | Codex | T4.2: 質問前に期待 memo id を pre-register、tool 呼び + target ヒットで合格判定 |
| D | served-snippets 最小 logger を切りすぎ (H2 を organic に測る唯一の計器) | HIGH | Claude | ~30行 append-only logger のみ Phase 3 に戻す (rotation は Phase 5 のまま) |
| E | Phase 2 cost accounting が過剰 (H1-H3 を何も検証しない) | MED | Codex | cost_usd 計算 + pricing config を Phase 5 へ defer、最小 event log のみ残す |
| F | torn-read guard を切りすぎ (MCP が書きかけ file を grep → eval data 汚染) | MED | 両モデル | full atomic 機構は defer のまま、1行 `fs.renameSync` だけ残す (<20分なら) |
| G | GitHub push が critical path に漏れている | MED | 両モデル | push は別計測、push 失敗で intake 成功判定を汚さない。git は学習目標として保持 |
| H | H3 の主張を狭めるべき | MED | Codex | plan に「ripgrep は exact/near-exact recall を検証、paraphrase 失敗 = semantic index の証拠であってバグではない」と明記 |
| I | recall init が初回検証には重い (idempotency polish は productization) | MED (taste) | Codex | → final gate の taste decision。stub-first なら init は H2 検証後に回せる |

**NOT in scope (CEO 確認)**: embeddings / rerank / curator agent / Notion sync / full safety gate / async queue / 24-path full set / 追加 CLI コマンド — すべて defer 維持で両モデル一致。**MVP に足すものは無い。**

**What already exists**: `lectures/lecture3/spec.md` (v6 フル設計、frontmatter/config/exit-code/test スキーマ確定済み) を実装時の参照ソースとして再利用。バックフィル frontmatter スキーマも spec で定義済み。

<!-- AUTONOMOUS DECISION LOG -->
### Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | H2 検証順序を「並行」に (Day 0-1 stub + recall add 並行) | **User Challenge → user 決定** | — | premise gate で user が「並行」を選択。両モデルは stub-first を推奨 | stub-first / 元順序 (Day 7) |
| 2 | CEO | Finding B: seed に ugly/paraphrase メモを混ぜる | Mechanical | P1 完全性 | clean corpus だと H3 が confound、測定の honesty | — |
| 3 | CEO | Finding C: eval で期待 memo id を pre-register | Mechanical | P1 完全性 | 主観 "5問中3問" を客観 target ヒットに | — |
| 4 | CEO | Finding D: served-snippets 最小 logger を Phase 3 に戻す | Mechanical | P2 blast radius (MCP server 内, ~30行) | H2 を organic に測る唯一の計器、rotation は defer 維持 | full observability を MVP に |
| 5 | CEO | Finding E: cost accounting を Phase 5 へ defer | Mechanical | P3 pragmatic | H1-H3 を検証しない、user の anti-bloat 意向に一致 | MVP に cost calc 保持 |
| 6 | CEO | Finding F: 1行 atomic rename のみ残す | Mechanical | P5 explicit | full tmp/uuid 機構なしで torn-read を防ぐ最小保険 | full atomic write / 完全 defer |
| 7 | CEO | Finding G: push を critical path から外す | Mechanical | P3 pragmatic | local commit が H1-H3 の真の依存、push は学習目標 | push を成功判定に含める |
| 8 | CEO | Finding H: H3 の主張を exact-recall に narrow | Mechanical | P5 explicit | paraphrase 失敗を「バグ」でなく「semantic index の証拠」と記録 | — |
| 9 | CEO | NOT in scope (embeddings/curator/notion/safety/queue/24test) defer 維持 | Mechanical | P3/P4 | 両モデル一致、MVP に足すもの無し | scope 拡大 |
| 10 | CEO | Finding I: recall init の timing | **Taste → final gate** | P5 | Codex のみ。init は MVP 3機能の一つだが stub-first なら後回し可 | — |

### Phase 3 — Eng Review (dual voices)

**ENG DUAL VOICES — CONSENSUS TABLE**

| # | Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|---|
| 1 | Architecture sound? | YES | YES (path-scoped commit 前提) | **CONFIRMED YES** — shared single-writer tree は単一 user MVP で妥当、1行 rename で十分 (同一 FS + glob 除外 条件付き) |
| 2 | Test coverage sufficient? | NO | NO | **CONFIRMED NO** — short_id collision/no-overwrite と write→search の e2e が欠落、MA1 単独では silent loss 防げない |
| 3 | Perf / 1s NFR? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — rg は速いが frontmatter parse 二次パスが未規定、候補 cap + rg timeout が必要 |
| 4 | Security / trust boundary? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — 不正 mcp.json が init を破壊しうる / 失敗時に raw body を stderr に出すと leak |
| 5 | Error paths handled? | PARTIAL | PARTIAL | **CONFIRMED PARTIAL** — intake 失敗 (MA1) は良いが collision-overwrite と git の nothing-to-commit 区別が未処理 |
| 6 | Stub→real transition? | YES | YES (schema 固定 条件付き) | **CONFIRMED YES** — tool name/description/inputSchema を stub で固定し verbatim 移植すれば H2 証拠が転移 |

**Eng findings (両モデル合意が中心、すべて小さい fix・infra 追加なし)**:

| # | Finding | Severity | 出所 | 対応 (適用済み) |
|---|---|---|---|---|
| E1 | short_id 16M は birthday paradox で衝突 (~33%/年 heavy)、無チェックで silent overwrite | **HIGH** | Claude (Codex も validation 文脈で) | T1.5 に existence-check リトライ、MU2 に衝突テスト |
| E2 | forced tool-use でも厳密 validation 必要 (tool_use 1個 / max_tokens reject / schema) | **HIGH** | Codex (Claude も max_tokens 言及) | T1.2 `parseSaveMemoToolUse`、MA1 に 2 ケース追加 |
| E3 | 最重要欠落テスト = `recall add` の temp-git e2e (write→commit→search) | **HIGH** | 両モデルが独立に #1 指摘 | 新テスト MI0 を Phase 1 に追加 |
| E4 | MCP ランクは rg だけで不可 (summary/body 分類・deleted・captured_at)、1s NFR | **HIGH** | 両モデル | T3.2 を rg→parse top-N→filter→rank に書き換え + cap + rg timeout |
| E5 | git subprocess 未規定 (argv / path-scoped commit / nothing-to-commit 区別) | MED | 両モデル | T1.7 を `execFile` + `commit --only -- <file>` に |
| E6 | throwaway stub が tool description ズレで H2 証拠を毒する | MED | 両モデル | T0.5a に schema 固定を明記 |
| E7 | 失敗時に raw body を stderr 出力 = 機微 leak | HIGH (security) | Codex (Claude は保全案) | T1.8: stderr に body 出さず `failed-add.log` (gitignore) へ |
| E8 | 不正 mcp.json で init crash / 他 server 破壊 | MED | Claude | T3.3 に try/catch + abort (上書き禁止) |
| E9 | 空入力で無駄 API call / 巨大入力で 8s timeout | MED | Claude | T1.0 入力ガード (empty reject + slice truncate) |
| E10 | AbortController 8s と SDK 自動 retry が衝突 | MED | 両モデル | T1.3 に `maxRetries:0, timeout:8000` |
| E11 | temp file がクロス FS / glob 未除外だと torn read 復活 | MED | Claude (Codex も hidden/*.md) | T1.6: 同一 dir `.tmp` + `--glob '!**/*.tmp'` |

**Eng は taste decision なし** — 全 finding が両モデル収束 or 一方向の小修正。両モデルとも defer 判断 (atomic 機構 / async push / full safety / 24-path) は正しいと明言、追加 infra の推奨なし。

| 11 | Eng | E1-E11 すべて適用 (small fix) | Mechanical | P5 explicit / P1 完全性 | 両モデル収束、データ消失・leak・NFR の実リスク除去、infra 追加ゼロ | 機構の MVP 復帰 |

### Phase 3.5 — DX Review (dual voices)

**DX scope**: Recall は developer tool。consumer は (1) 人間の author、(2) **Claude Code = AI agent** (search_memos を呼ぶか判断)。後者の DX surface = tool description。

**DX DUAL VOICES — CONSENSUS TABLE**

| # | Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|---|
| 1 | TTHW < 10 min? | NO (at risk) | Not yet | **CONFIRMED NO** — 7 steps が ~12-15 actions を隠蔽、PATH/keychain/restart が silent fail |
| 2 | tool description first-class? | NO (4/10) | Partially | **CONFIRMED NO** — H2 を駆動する変数なのに Day-7 fallback 扱い、generic で over-promise |
| 3 | error messages actionable? | PARTIAL (6/10) | Partially | **CONFIRMED PARTIAL** — init は良いが add は missing-API-key の specific message 欠落 |
| 4 | CLI naming guessable? | YES | Good enough | **CONFIRMED YES** — add/init/mcp serve は一貫、stdin だけ未実装 |
| 5 | MCP-restart cliff handled? | PARTIAL | Partially | **CONFIRMED PARTIAL** — 表示はあるが post-restart 検証なし、「未ロード」と「呼ばれない」が判別不能 |
| 6 | DX prioritized for single-user? | YES | Mostly good | **CONFIRMED YES** — defer list 正しい、追加は全て Day-1 author-facing の小修正 |

**DX scores**: getting-started **6/10** / error-quality **6/10** / tool-description **4/10**。

**DX findings**:

| # | Finding | Severity | 出所 | 対応 |
|---|---|---|---|---|
| DX1 | tool description が一級扱いされていない (H2 の主独立変数) | **HIGH** | 両モデル | §4 に behavioral description v1 を新設、Day 0 authoring に前倒し、acceptance 化 |
| DX2 | TTHW silent cliffs (PATH/keychain/restart) | **HIGH** | 両モデル | T3.4c: init 末尾に self-check + smoke test (doctor 新コマンドは作らない) |
| DX3 | MCP restart cliff の post-restart 検証なし | HIGH | 両モデル | T3.5: 「tool registered か」と「agent が呼んだか」を分離する probe |
| DX4 | error message contract 未規定 | MED | 両モデル | T1.9: what/why/status/fix template + missing-API-key pre-flight |
| DX5 | stale 矛盾 (§6 risk table が "raw を stderr" のまま) | MED | Codex | §6 risk table を T1.8 と一致させた |
| DX6 | stdin 未実装 (`pbpaste \| recall add`) | MED | Claude | T1.1 に stdin support |

**DX taste decision (1 件、両モデルが分岐)**:

| # | 論点 | Claude | Codex | autoplan 判断 |
|---|---|---|---|---|
| DX-T | setup self-check の形 | `recall doctor` 新コマンド | doctor は premature、init に畳む | **init に畳む** (P3 pragmatic / 新コマンド無し / user anti-bloat)。→ final gate で確認 |

**Developer journey (MVP, Day-1)**: `gh repo create` → `clone && pnpm i && pnpm link` → keychain 登録 → `recall init` (self-check + smoke 手順表示) → **Claude Code 再起動** → `recall add "smoke"` → Claude Code に「どんな tool ある?」で registered 確認 → smoke 質問で呼び出し確認。TTHW 目標 **happy path 10 分** だが silent cliff 解消が前提。

| 12 | DX | DX1-DX6 適用 (description 前倒し / init self-check / error template / stdin / 矛盾修正) | Mechanical | P1 完全性 / P5 explicit | 両モデル収束、全て Day-1 author-facing の小修正、future-user polish なし | npm/doctor/installer polish |
| 13 | DX | DX-T: self-check を init に畳む (doctor 新コマンド却下) | **Taste → final gate** | P3 pragmatic | Codex 寄り、新コマンド回避、anti-bloat | `recall doctor` 独立コマンド |

## GSTACK REVIEW REPORT

**VERDICT: APPROVED as-is (2026-05-26)** — 3 phase 全て両モデル consensus、scope 追加なし。taste decision 2 件は leaner option で確定 (init を MVP 維持 / self-check は init に畳む)。

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| CEO Review | `plan-ceo-review` (via autoplan) | 1 | clean | 6/6 confirmed、premise gate = parallel validation |
| Eng Review | `plan-eng-review` (via autoplan) | 1 | clean | 11 small fix 適用 (E1-E11)、infra 追加なし |
| Design Review | — | 0 | skipped | UI scope なし (CLI + MCP) |
| DX Review | `plan-devex-review` (via autoplan) | 1 | clean | 6 fix 適用、tool description 一級化が最重要 |
| Dual Voices | Codex + Claude subagent | 3 phase | clean | CEO/Eng/DX 各 6/6 confirmed, 0 disagree |

**Cross-phase theme**: tool description / H2 validation integrity が CEO・Eng・DX の 3 phase に独立出現 → 最高信頼の signal。MVP の最重要 artifact。

**成果物**: `plans/plan.md` (本書) / `plans/task.md` (TDD checklist) / test-plan artifact (`~/.gstack/projects/usagi917-usagi1114-web3ai-2026/usagi917-main-test-plan-20260526.md`)。


