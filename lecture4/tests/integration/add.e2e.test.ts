// recall add の end-to-end 統合テスト (MI0 / ENG E3 — 最重要)。
// 本物の Anthropic は呼ばず AnthropicLike client をモック注入し、temp git repo を vault にして検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../src/types.ts';
import type { AnthropicLike } from '../../src/core/intake.ts';
import { SAVE_MEMO_TOOL_NAME } from '../../src/core/intake.ts';
import { parseMemo } from '../../src/core/frontmatter.ts';
import { failedAddLogPath } from '../../src/paths.ts';
import { runAdd } from '../../src/commands/add.ts';

let tmp: string;
let vault: string;
let recallHome: string;
let config: Config;
const savedEnv: Record<string, string | undefined> = {};

/** save_memo の正常な tool_use を返す Anthropic.Message モックを組み立てる。 */
function makeOkMessage(saveMemo: {
  agent_summary: string;
  slug: string;
  quarantine_reason: string | null;
}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    container: null,
    stop_details: null,
    stop_sequence: null,
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: SAVE_MEMO_TOOL_NAME,
        input: saveMemo,
        caller: { type: 'direct' },
      } as Anthropic.ToolUseBlock,
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}

/** AnthropicLike を満たすモック client を作る。 */
function makeClient(
  createImpl: AnthropicLike['messages']['create'],
): AnthropicLike {
  return { messages: { create: createImpl } };
}

/** vault 配下の .md ファイル (絶対パス) を再帰収集する。 */
function findMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** vault 配下の .tmp ファイルを再帰収集する。 */
function findTmpFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTmpFiles(full));
    } else if (entry.name.endsWith('.tmp')) {
      out.push(full);
    }
  }
  return out;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'recall-add-'));
  vault = join(tmp, 'vault');
  recallHome = join(tmp, 'recall-home');

  // vault を git repo として初期化。
  execFileSync('git', ['init', vault], { stdio: 'ignore' });
  execFileSync('git', ['-C', vault, 'config', 'user.email', 'test@example.com'], {
    stdio: 'ignore',
  });
  execFileSync('git', ['-C', vault, 'config', 'user.name', 'Recall Test'], {
    stdio: 'ignore',
  });
  // push が必ず失敗するよう bogus remote を設定する。
  execFileSync(
    'git',
    ['-C', vault, 'remote', 'add', 'origin', '/nonexistent/repo.git'],
    { stdio: 'ignore' },
  );

  // env 隔離。
  savedEnv.RECALL_HOME = process.env.RECALL_HOME;
  savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  process.env.RECALL_HOME = recallHome;
  process.env.ANTHROPIC_API_KEY = 'test';

  config = {
    vault_path: vault,
    repo_url: '/nonexistent/repo.git',
    agent_model: 'claude-sonnet-4-6',
    agent_max_input_tokens: 8000,
    agent_max_output_tokens: 512,
    anthropic_api_key_source: 'env',
    log_path: join(recallHome, 'logs', 'recall.jsonl'),
    pricing: { input_per_mtok_usd: 3.0, output_per_mtok_usd: 15.0 },
  };

  // stdout/stderr/warn 出力はテストノイズなので抑制する。
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  for (const k of ['RECALL_HOME', 'ANTHROPIC_API_KEY'] as const) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('runAdd e2e (MI0 / ENG E3)', () => {
  it('intake→write→commit を通し、push 失敗でも exit 0 で .md を 1 個だけ commit する', async () => {
    const create = vi.fn(async () =>
      makeOkMessage({
        agent_summary: 'プロンプトキャッシュの TTL に関するメモ。',
        slug: 'prompt-caching-ttl',
        quarantine_reason: null,
      }),
    );
    const client = makeClient(create);

    const now = new Date(2026, 4, 26, 9, 30, 0); // 2026-05-26 09:30:00 ローカル
    const code = await runAdd('プロンプトキャッシュの TTL について。', {
      now,
      client,
      config,
    });

    // push が失敗しても exit 0。
    expect(code).toBe(0);
    // intake は 1 回だけ呼ばれる (本物の API は呼ばない)。
    expect(create).toHaveBeenCalledTimes(1);

    // .md がちょうど 1 個、YYYY/MM/DD-<slug>-<short_id>.md の形で生成される。
    const mdFiles = findMarkdownFiles(vault);
    expect(mdFiles).toHaveLength(1);
    const mdPath = mdFiles[0]!;
    expect(mdPath).toMatch(
      /\/2026\/05\/26-prompt-caching-ttl-[0-9a-f]{6}\.md$/,
    );

    // .tmp が残っていない。
    expect(findTmpFiles(vault)).toHaveLength(0);

    // frontmatter が期待どおり。
    const { frontmatter } = parseMemo(readFileSync(mdPath, 'utf8'));
    expect(frontmatter.slug).toBe('prompt-caching-ttl');
    expect(frontmatter.agent_summary).toBe(
      'プロンプトキャッシュの TTL に関するメモ。',
    );
    expect(frontmatter.source).toBe('manual');
    expect(frontmatter.deleted).toBe(false);
    expect(frontmatter.truncated).toBe(false);
    expect(frontmatter.agent_model).toBe('claude-sonnet-4-6');

    // そのファイルだけが commit されている (git log --name-only)。
    const logOut = execFileSync(
      'git',
      ['-C', vault, 'log', '--name-only', '--pretty=format:%s'],
      { encoding: 'utf8' },
    );
    expect(logOut).toContain('add: prompt-caching-ttl');
    const committedPaths = logOut
      .split('\n')
      .filter((l) => l.endsWith('.md'));
    expect(committedPaths).toEqual([
      '2026/05/26-prompt-caching-ttl-' +
        mdPath.match(/-([0-9a-f]{6})\.md$/)![1] +
        '.md',
    ]);

    // ファイルは依然 vault に存在する (push 失敗が intake 成功判定を汚していない)。
    expect(existsSync(mdPath)).toBe(true);
  });

  it('空入力は API 呼び出し前に RecallError を throw する', async () => {
    const create = vi.fn(async () =>
      makeOkMessage({ agent_summary: 's', slug: 's', quarantine_reason: null }),
    );
    const client = makeClient(create);
    await expect(runAdd('   ', { client, config })).rejects.toThrow(
      /入力が空/,
    );
    // intake は呼ばれない。
    expect(create).not.toHaveBeenCalled();
    // .md も作られない。
    expect(findMarkdownFiles(vault)).toHaveLength(0);
  });

  it('intake が throw したら exit 1、raw を failed-add.log に退避し .md は作らない', async () => {
    const create = vi.fn(async () => {
      throw new Error('Internal Server Error');
    });
    const client = makeClient(create);

    const code = await runAdd('保全したい秘密のメモ本文', { client, config });
    expect(code).toBe(1);

    // failed-add.log に raw が退避される。
    const logPath = failedAddLogPath();
    expect(existsSync(logPath)).toBe(true);
    const logged = readFileSync(logPath, 'utf8');
    expect(logged).toContain('保全したい秘密のメモ本文');

    // .md は作られない。
    expect(findMarkdownFiles(vault)).toHaveLength(0);
    expect(findTmpFiles(vault)).toHaveLength(0);
  });

  it('invalid slug は fallback slug (memo-YYYYMMDD-HHMMSS) で保存される', async () => {
    const create = vi.fn(async () =>
      makeOkMessage({
        agent_summary: '不正 slug のメモ。',
        slug: 'Invalid Slug!!',
        quarantine_reason: null,
      }),
    );
    const client = makeClient(create);

    const now = new Date(2026, 4, 26, 9, 30, 15);
    const code = await runAdd('本文', { now, client, config });
    expect(code).toBe(0);

    const mdFiles = findMarkdownFiles(vault);
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0]!).toMatch(
      /26-memo-20260526-093015-[0-9a-f]{6}\.md$/,
    );
  });
});
