// intake モジュール — recall add の本文を Anthropic Messages API に渡し、
// forced tool-use (`save_memo`) で {agent_summary, slug, quarantine_reason} を得る (T1.2 / T1.3 / ENG E2,E10,MA1)。
// body 本文は再生成させない。ファイル I/O は一切せず、失敗はそのまま throw する (保全は呼び出し側 add.ts の責務)。

import Anthropic from '@anthropic-ai/sdk';
import type { SaveMemoInput } from '../types.ts';

/** agent_summary の上限ガード (要約が肥大化していないかの sanity check)。 */
const MAX_SUMMARY_LENGTH = 600;

/** forced tool-use 用の dummy tool 名。tool_choice でこれを強制する。 */
export const SAVE_MEMO_TOOL_NAME = 'save_memo';

/** intake 固有の検証 / 実行エラー。呼び出し側で instanceof 判定しやすいよう専用クラスにする。 */
export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}

/** runIntake の戻り値。構造化出力 + token 使用量 + 経過時間を含む。 */
export interface IntakeResult {
  saveMemo: SaveMemoInput;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * テスト時にモック注入できるよう、runIntake が依存する最小インターフェースだけを切り出す。
 * 実体は `new Anthropic()` で満たせる (Anthropic は messages.create を持つ)。
 */
export interface AnthropicLike {
  messages: {
    create: (
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: Anthropic.RequestOptions,
    ) => Promise<Anthropic.Message>;
  };
}

/** runIntake のパラメータ。client を注入可能にしてテストでモックを差し込めるようにする。 */
export interface RunIntakeParams {
  body: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  /** 直近 slug 一覧 (重複回避ヒントとして system prompt に埋め込む)。 */
  recentSlugs?: string[];
  /** 未指定なら new Anthropic({ apiKey }) を生成する。 */
  client?: AnthropicLike;
  /** hard timeout (ms)。未指定なら 8000。 */
  timeoutMs?: number;
}

/** hard timeout の既定値 (ms)。SDK 自動 retry が予算を食わないよう maxRetries:0 と併用する (ENG E10)。 */
const DEFAULT_TIMEOUT_MS = 8000;

/** save_memo dummy tool の定義 (input_schema: object {agent_summary, slug, quarantine_reason})。 */
const SAVE_MEMO_TOOL: Anthropic.Tool = {
  name: SAVE_MEMO_TOOL_NAME,
  description:
    '与えられた本文の要約・slug・隔離理由を記録する。本文そのものは引数に含めない。',
  input_schema: {
    type: 'object',
    properties: {
      agent_summary: {
        type: 'string',
        description: '本文を 1〜2 文で要約したもの。本文の丸写しは禁止。',
      },
      slug: {
        type: 'string',
        description: 'kebab-case の短い識別子 (例: prompt-caching-ttl)。',
      },
      quarantine_reason: {
        type: ['string', 'null'],
        description:
          '個人情報など隔離すべき理由があれば文字列で、なければ null。',
      },
    },
    required: ['agent_summary', 'slug', 'quarantine_reason'],
  },
};

/** system prompt を組み立てる。recentSlugs があれば重複回避ヒントとして列挙する。 */
function buildSystemPrompt(recentSlugs: string[] | undefined): string {
  const base = [
    'あなたは開発者個人のメモ vault の取り込みアシスタントです。',
    '与えられた本文を読み、save_memo ツールを必ず 1 回だけ呼び出してください。',
    '- agent_summary: 本文の要点を 1〜2 文で日本語要約する。本文を丸写ししない。',
    '- slug: 内容を表す kebab-case (小文字英数とハイフン) の短い識別子を提案する。',
    '- quarantine_reason: 個人情報 (氏名・連絡先・認証情報など) を含むと判断したら理由を文字列で、含まなければ null を渡す。',
    '本文そのものは返さない (要約のみ)。',
  ];
  if (recentSlugs && recentSlugs.length > 0) {
    base.push(
      `直近で使用済みの slug (重複を避けること): ${recentSlugs.join(', ')}`,
    );
  }
  return base.join('\n');
}

/**
 * A. Anthropic の Message を厳密 validate して SaveMemoInput を組み立てる純粋関数 (T1.2 / ENG E2, MA1)。
 * 契約を満たさない場合は IntakeError を throw する。
 */
export function parseSaveMemoToolUse(message: Anthropic.Message): SaveMemoInput {
  // 出力が途中で切れている (max_tokens) のは reject。tool_use 正常終了以外も reject。
  if (message.stop_reason === 'max_tokens') {
    throw new IntakeError(
      'LLM 出力が max_tokens で切断されました (構造化出力が不完全)。',
    );
  }
  if (message.stop_reason !== 'tool_use') {
    throw new IntakeError(
      `想定外の stop_reason です: ${String(message.stop_reason)} (tool_use を期待)。`,
    );
  }

  // tool_use ブロックが「ちょうど 1 個」かつ name === 'save_memo' であること。
  const toolUseBlocks = message.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (toolUseBlocks.length !== 1) {
    throw new IntakeError(
      `save_memo の tool_use ブロックがちょうど 1 個ではありません (検出 ${toolUseBlocks.length} 個)。`,
    );
  }
  const block = toolUseBlocks[0];
  // noUncheckedIndexedAccess のため undefined ガード (length チェック済みだが型の都合上)。
  if (block === undefined) {
    throw new IntakeError('tool_use ブロックの取得に失敗しました。');
  }
  if (block.name !== SAVE_MEMO_TOOL_NAME) {
    throw new IntakeError(
      `想定外の tool 名です: ${block.name} (${SAVE_MEMO_TOOL_NAME} を期待)。`,
    );
  }

  // input を schema validate する。
  const input = block.input;
  if (typeof input !== 'object' || input === null) {
    throw new IntakeError('tool_use.input がオブジェクトではありません。');
  }
  const record = input as Record<string, unknown>;

  // agent_summary: 非空 string、上限ガードあり。
  const agentSummary = record['agent_summary'];
  if (typeof agentSummary !== 'string' || agentSummary.trim().length === 0) {
    throw new IntakeError('agent_summary が非空文字列ではありません。');
  }
  if (agentSummary.length > MAX_SUMMARY_LENGTH) {
    throw new IntakeError(
      `agent_summary が長すぎます (${agentSummary.length} > ${MAX_SUMMARY_LENGTH} 文字)。`,
    );
  }

  // slug: string であること (具体的な slug 規約検証は slug.ts の resolveSlug が担う)。
  const slug = record['slug'];
  if (typeof slug !== 'string') {
    throw new IntakeError('slug が文字列ではありません。');
  }

  // quarantine_reason: string または null。未指定 (undefined) は null に正規化。
  const rawReason = record['quarantine_reason'];
  let quarantineReason: string | null;
  if (rawReason === undefined || rawReason === null) {
    quarantineReason = null;
  } else if (typeof rawReason === 'string') {
    quarantineReason = rawReason;
  } else {
    throw new IntakeError(
      'quarantine_reason が文字列でも null でもありません。',
    );
  }

  return {
    agent_summary: agentSummary,
    slug,
    quarantine_reason: quarantineReason,
  };
}

/**
 * B. 本文を Anthropic Messages API に forced tool-use で渡し、構造化出力を得る (T1.2 / T1.3 / ENG E10)。
 * hard timeout (既定 8s) を AbortController で実装し、SDK 自動 retry は maxRetries:0 で無効化する。
 * create が reject (timeout / network / 5xx 等) したらそのまま throw する。
 */
export async function runIntake(params: RunIntakeParams): Promise<IntakeResult> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client: AnthropicLike =
    params.client ?? new Anthropic({ apiKey: params.apiKey });

  // hard timeout: setTimeout で abort し、SDK 側にも signal / timeout を渡す。
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
    model: params.model,
    max_tokens: params.maxOutputTokens,
    system: buildSystemPrompt(params.recentSlugs),
    tools: [SAVE_MEMO_TOOL],
    tool_choice: { type: 'tool', name: SAVE_MEMO_TOOL_NAME },
    messages: [{ role: 'user', content: params.body }],
  };

  const start = Date.now();
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(requestBody, {
      signal: controller.signal,
      maxRetries: 0,
      timeout: timeoutMs,
    });
  } catch (err) {
    // abort 由来かどうかを message に含めて分かりやすくする。
    if (controller.signal.aborted) {
      throw new IntakeError(
        `intake が ${timeoutMs}ms の hard timeout を超過し中断しました: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // timeout 以外 (network / 5xx 等) はそのまま throw する。
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - start;
  const saveMemo = parseSaveMemoToolUse(message);

  return {
    saveMemo,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    latencyMs,
  };
}
