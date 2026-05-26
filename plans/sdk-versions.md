# SDK / ツールチェーン確定版 (T0.1, 2026-05-26 確認)

`npm view` で確認した実バージョン。`lecture4/package.json` はこれに pin する。

| パッケージ / ツール | バージョン | 用途 |
|---|---|---|
| node | v25.2.1 | ランタイム (ESM, ネイティブ TS strip 可だが tsx 経由で実行) |
| pnpm | 10.28.0 | パッケージマネージャ (npm/yarn 禁止) |
| ripgrep (`rg`) | 14.1.1 | MCP `search_memos` の検索エンジン (T0.3 OK) |
| git | 2.50.1 | memo-vault commit/push |
| `@anthropic-ai/sdk` | 0.98.0 | intake (Messages API + forced tool-use JSON) |
| `@modelcontextprotocol/sdk` | 1.29.0 | `recall mcp serve` |
| `tsx` | 4.22.3 | TS 実行 (bin ローダ + dev) |
| `vitest` | 4.1.7 | テスト (Red→Green→Refactor) |
| `typescript` | 6.0.3 | typecheck (`tsc --noEmit`) |

## T0.1 補足: SDK の `signal` / `timeout` / `maxRetries` サポート

- `@anthropic-ai/sdk` 0.98.0 の `messages.create(params, options)` は第2引数 `options` に
  `{ signal, timeout, maxRetries }` を受ける。T1.3 は `{ signal, maxRetries: 0, timeout: 8000 }` を渡し、
  SDK 自動リトライが 8s 予算を食い潰すのを防ぐ (ENG E10)。

## T0.2 価格 (要 Anthropic console 実確認)

- 暫定: Sonnet 4.6 input $3 / MTok, output $15 / MTok を `config.pricing` の既定値に採用。
- **TODO (user)**: Anthropic console で実価格を確認し、試算とズレ 2 倍以内か検証。MVP は cost 計算を
  Phase 5 へ defer (CEO finding E) のため、ここは config 既定値の記録のみ。

## ランタイム方針 (lecture4)

- ESM (`"type": "module"`) + `moduleResolution: bundler` (拡張子なし import 可)。
- 実行は `tsx`。bin (`bin/recall.mjs`) が `tsx/esm/api` の `register()` を呼んでから `src/cli.ts` を import。
- ビルド工程なし。`pnpm link --global` で `recall` を PATH に通す。
- Claude Code が `recall mcp serve` を spawn する際もこの bin 経由。
