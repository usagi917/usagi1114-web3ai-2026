// recall add の event log (append-only, T2.1)。1 行 1 JSON で recall.jsonl に追記する。
// cost 計算は Phase 5 へ defer。ロギングの失敗で本処理を落とさないため例外は握りつぶす。
import { appendFileSync, mkdirSync } from 'node:fs';
import { logsDir, recallLogPath } from './paths.ts';

/** recall.jsonl の 1 レコード。各 latency は ms、push 失敗時 push_latency_ms は null。 */
export interface RecallLogEntry {
  ts: string;
  action: 'add';
  slug: string;
  input_chars: number;
  agent_latency_ms: number;
  write_latency_ms: number;
  commit_latency_ms: number;
  push_latency_ms: number | null;
  quarantine_reason: string | null;
}

/**
 * logs ディレクトリを mkdir -p し recall.jsonl に 1 行 JSON を append する。
 * 例外は握りつぶす (ロギングで本処理を落とさない)。
 */
export function appendRecallLog(entry: RecallLogEntry): void {
  try {
    mkdirSync(logsDir(), { recursive: true });
    appendFileSync(recallLogPath(), JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // ロギング失敗は無視する。
  }
}
