// intake モジュールの unit テスト (MA1)。
// 本物の Anthropic API は呼ばず、AnthropicLike を満たすモック client を注入して検証する。

import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  parseSaveMemoToolUse,
  runIntake,
  IntakeError,
  SAVE_MEMO_TOOL_NAME,
  type AnthropicLike,
} from '../../src/core/intake.ts';

/** Anthropic.Message 形状のモックを最小限のフィールドで組み立てる (型は as でキャスト)。 */
function makeMessage(overrides: {
  content?: Anthropic.Message['content'];
  stop_reason?: Anthropic.Message['stop_reason'];
  input_tokens?: number;
  output_tokens?: number;
}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    container: null,
    stop_details: null,
    stop_sequence: null,
    stop_reason: overrides.stop_reason ?? 'tool_use',
    content: overrides.content ?? [],
    usage: {
      input_tokens: overrides.input_tokens ?? 100,
      output_tokens: overrides.output_tokens ?? 20,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Anthropic.Message;
}

/** save_memo の tool_use ブロックを組み立てる。 */
function toolUseBlock(
  input: unknown,
  name: string = SAVE_MEMO_TOOL_NAME,
): Anthropic.ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'toolu_test',
    name,
    input,
    caller: { type: 'direct' },
  } as Anthropic.ToolUseBlock;
}

/** text ブロックを組み立てる。 */
function textBlock(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null } as Anthropic.ContentBlock;
}

/** AnthropicLike を満たすモック client を作る。 */
function makeClient(
  createImpl: AnthropicLike['messages']['create'],
): AnthropicLike {
  return { messages: { create: createImpl } };
}

const baseParams = {
  body: '本文です',
  apiKey: 'test-key',
  model: 'claude-sonnet-4-6',
  maxOutputTokens: 512,
};

describe('parseSaveMemoToolUse (T1.2 / MA1)', () => {
  it('正常な tool_use メッセージから SaveMemoInput を返す', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({
          agent_summary: 'プロンプトキャッシュの TTL に関するメモ。',
          slug: 'prompt-caching-ttl',
          quarantine_reason: null,
        }),
      ],
    });
    expect(parseSaveMemoToolUse(msg)).toEqual({
      agent_summary: 'プロンプトキャッシュの TTL に関するメモ。',
      slug: 'prompt-caching-ttl',
      quarantine_reason: null,
    });
  });

  it('quarantine_reason が文字列ならそのまま保持する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({
          agent_summary: '連絡先を含む。',
          slug: 'contact-info',
          quarantine_reason: 'メールアドレスを含む',
        }),
      ],
    });
    expect(parseSaveMemoToolUse(msg).quarantine_reason).toBe(
      'メールアドレスを含む',
    );
  });

  it('quarantine_reason 未指定 (undefined) は null に正規化する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({
          agent_summary: '要約のみ。',
          slug: 'summary-only',
        }),
      ],
    });
    expect(parseSaveMemoToolUse(msg).quarantine_reason).toBeNull();
  });

  it('stop_reason が max_tokens なら IntakeError を throw する', () => {
    const msg = makeMessage({
      stop_reason: 'max_tokens',
      content: [
        toolUseBlock({
          agent_summary: '切断された要約',
          slug: 'truncated',
          quarantine_reason: null,
        }),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(IntakeError);
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/max_tokens/);
  });

  it('tool_use 以外の stop_reason (end_turn) は reject する', () => {
    const msg = makeMessage({
      stop_reason: 'end_turn',
      content: [textBlock('ただのテキスト')],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(IntakeError);
  });

  it('tool_use ブロックが 0 個 (text のみ) なら throw する', () => {
    const msg = makeMessage({
      stop_reason: 'tool_use',
      content: [textBlock('テキストだけ')],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/ちょうど 1 個ではありません/);
  });

  it('tool_use ブロックが複数なら throw する', () => {
    const valid = {
      agent_summary: '要約',
      slug: 'slug-a',
      quarantine_reason: null,
    };
    const msg = makeMessage({
      content: [toolUseBlock(valid), toolUseBlock(valid)],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/ちょうど 1 個ではありません/);
  });

  it('別名 tool は reject する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock(
          { agent_summary: '要約', slug: 's', quarantine_reason: null },
          'other_tool',
        ),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/想定外の tool 名/);
  });

  it('agent_summary が空文字なら throw する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({ agent_summary: '   ', slug: 's', quarantine_reason: null }),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/agent_summary/);
  });

  it('agent_summary が上限超過なら throw する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({
          agent_summary: 'あ'.repeat(601),
          slug: 's',
          quarantine_reason: null,
        }),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/長すぎます/);
  });

  it('slug が文字列でないなら throw する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({ agent_summary: '要約', slug: 123, quarantine_reason: null }),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/slug/);
  });

  it('quarantine_reason が string でも null でもないなら throw する', () => {
    const msg = makeMessage({
      content: [
        toolUseBlock({ agent_summary: '要約', slug: 's', quarantine_reason: 42 }),
      ],
    });
    expect(() => parseSaveMemoToolUse(msg)).toThrow(/quarantine_reason/);
  });
});

describe('runIntake (T1.2 / T1.3 / ENG E10 / MA1)', () => {
  it('正常: モック create の結果から SaveMemoInput と usage / latency を返す', async () => {
    const create = vi.fn(async () =>
      makeMessage({
        content: [
          toolUseBlock({
            agent_summary: 'TTL のメモ',
            slug: 'ttl-memo',
            quarantine_reason: null,
          }),
        ],
        input_tokens: 321,
        output_tokens: 45,
      }),
    );
    const client = makeClient(create);

    const result = await runIntake({ ...baseParams, client });

    expect(result.saveMemo).toEqual({
      agent_summary: 'TTL のメモ',
      slug: 'ttl-memo',
      quarantine_reason: null,
    });
    expect(result.inputTokens).toBe(321);
    expect(result.outputTokens).toBe(45);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('forced tool-use の request body と options を正しく組み立てる', async () => {
    // create に渡された body / options を捕捉する (型は AnthropicLike の create シグネチャで確定)。
    let body!: Parameters<AnthropicLike['messages']['create']>[0];
    let options: Parameters<AnthropicLike['messages']['create']>[1];
    const create = vi.fn<AnthropicLike['messages']['create']>(async (b, o) => {
      body = b;
      options = o;
      return makeMessage({
        content: [
          toolUseBlock({
            agent_summary: '要約',
            slug: 's',
            quarantine_reason: null,
          }),
        ],
      });
    });
    const client = makeClient(create);

    await runIntake({
      ...baseParams,
      client,
      recentSlugs: ['prev-slug-a', 'prev-slug-b'],
    });

    expect(create).toHaveBeenCalledTimes(1);
    // forced tool-use の検証
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'save_memo' });
    expect(body.tools?.[0]?.name).toBe('save_memo');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(512);
    expect(body.messages).toEqual([{ role: 'user', content: '本文です' }]);
    // recentSlugs が system prompt に埋め込まれる
    expect(typeof body.system).toBe('string');
    expect(body.system as string).toContain('prev-slug-a');
    expect(body.system as string).toContain('prev-slug-b');
    // options: signal / maxRetries:0 / timeout が渡る (ENG E10)
    expect(options?.maxRetries).toBe(0);
    expect(options?.timeout).toBe(8000);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('max_tokens 切断メッセージは runIntake が throw する', async () => {
    const create = vi.fn(async () =>
      makeMessage({
        stop_reason: 'max_tokens',
        content: [
          toolUseBlock({
            agent_summary: '切断',
            slug: 's',
            quarantine_reason: null,
          }),
        ],
      }),
    );
    const client = makeClient(create);
    await expect(runIntake({ ...baseParams, client })).rejects.toThrow(
      IntakeError,
    );
  });

  it('tool_use 不在 (text のみ) は runIntake が throw する', async () => {
    const create = vi.fn(async () =>
      makeMessage({ stop_reason: 'tool_use', content: [textBlock('text')] }),
    );
    const client = makeClient(create);
    await expect(runIntake({ ...baseParams, client })).rejects.toThrow(
      IntakeError,
    );
  });

  it('timeout: abort 由来の reject は IntakeError (timeout 文言) で throw する', async () => {
    // create が短い timeout 中に abort されるのを再現する。
    const create: AnthropicLike['messages']['create'] = (_body, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('Request was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    const client = makeClient(create);

    await expect(
      runIntake({ ...baseParams, client, timeoutMs: 20 }),
    ).rejects.toThrow(IntakeError);
    await expect(
      runIntake({ ...baseParams, client, timeoutMs: 20 }),
    ).rejects.toThrow(/hard timeout/);
  });

  it('5xx: status 500 相当の Error reject はそのまま throw する (IntakeError でなく原 Error)', async () => {
    const apiError = Object.assign(new Error('Internal Server Error'), {
      status: 500,
    });
    const create = vi.fn(async () => {
      throw apiError;
    });
    const client = makeClient(create);

    await expect(runIntake({ ...baseParams, client })).rejects.toBe(apiError);
  });

  it('network error はそのまま throw する', async () => {
    const netErr = new Error('ECONNRESET');
    const create = vi.fn(async () => {
      throw netErr;
    });
    const client = makeClient(create);
    await expect(runIntake({ ...baseParams, client })).rejects.toBe(netErr);
  });
});
