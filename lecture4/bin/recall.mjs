#!/usr/bin/env node
// recall bin loader — tsx の ESM ローダを登録してから TS エントリポイントを読み込む。
// ビルド工程を持たず、pnpm link / Claude Code からの spawn 両方でそのまま動く。
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';

register();
await import(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
