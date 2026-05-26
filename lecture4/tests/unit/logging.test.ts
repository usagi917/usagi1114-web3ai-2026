// logging.ts の unit テスト (T2.1)。RECALL_HOME を temp に向けて append を検証する。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecallLog, type RecallLogEntry } from '../../src/logging.ts';
import { recallLogPath } from '../../src/paths.ts';

let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'recall-log-'));
  savedEnv.RECALL_HOME = process.env.RECALL_HOME;
  process.env.RECALL_HOME = join(tmp, 'recall-home');
});

afterEach(() => {
  if (savedEnv.RECALL_HOME === undefined) delete process.env.RECALL_HOME;
  else process.env.RECALL_HOME = savedEnv.RECALL_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

const entry: RecallLogEntry = {
  ts: '2026-05-26T09:30:00.000Z',
  action: 'add',
  slug: 'demo',
  input_chars: 42,
  agent_latency_ms: 100,
  write_latency_ms: 2,
  commit_latency_ms: 5,
  push_latency_ms: null,
  quarantine_reason: null,
};

describe('appendRecallLog', () => {
  it('logs ディレクトリを作り 1 行 JSON を append する', () => {
    appendRecallLog(entry);
    const p = recallLogPath();
    expect(existsSync(p)).toBe(true);
    const lines = readFileSync(p, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(entry);
  });

  it('複数回呼ぶと行が積み上がる', () => {
    appendRecallLog(entry);
    appendRecallLog({ ...entry, slug: 'demo-2' });
    const lines = readFileSync(recallLogPath(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).slug).toBe('demo-2');
  });
});
