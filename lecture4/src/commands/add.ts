// recall add — intake → ファイル書き込み → git commit/push を束ねる統合層。
// 入力ガード → API キー pre-flight → 最小 redaction → LLM intake → frontmatter+body 組み立て
// → atomic write (YYYY/MM/DD-<slug>-<short_id>.md) → git add/commit (同期) → git push (失敗は隔離)。
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config, Frontmatter } from '../types.ts';
import { RecallError } from '../errors.ts';
import { loadConfig, resolveApiKey } from '../config.ts';
import { failedAddLogPath } from '../paths.ts';
import { resolveSlug } from '../core/slug.ts';
import { generateUniqueShortId } from '../core/shortId.ts';
import { redactSecrets } from '../core/redaction.ts';
import { serializeMemo } from '../core/frontmatter.ts';
import { runIntake, type AnthropicLike } from '../core/intake.ts';
import { gitAddCommit, gitPush } from '../git.ts';
import { appendRecallLog } from '../logging.ts';

/** token → char のざっくり換算係数 (1 token ≈ 4 chars)。入力上限の char 換算に使う。 */
const CHARS_PER_TOKEN = 4;

/** intake の hard timeout (ms)。 */
const INTAKE_TIMEOUT_MS = 8000;

/** commit までの合計がこの閾値 (ms) を超えたら警告 (T2.3, MVP は警告のみ)。 */
const SLOW_WARN_THRESHOLD_MS = 3000;

/** 2 桁ゼロ埋め。 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** now をローカル TZ offset 付き ISO 8601 (例 2026-05-26T09:30:00+09:00) に整形する。 */
function toLocalIso8601(now: Date): string {
  const y = now.getFullYear();
  const mo = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const s = pad2(now.getSeconds());
  // getTimezoneOffset は「UTC との差を分で、符号は東が負」なので反転して扱う。
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
}

/** raw な元 input を failed-add.log に退避する (gitignore/local 専用)。失敗は握りつぶす。 */
function appendFailedAdd(rawInput: string): void {
  try {
    const path = failedAddLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), raw: rawInput }) + '\n';
    appendFileSync(path, line, 'utf8');
  } catch {
    // 退避ログの失敗は無視する。
  }
}

/**
 * recall add の本体。返り値は exit code。
 * RecallError は呼び出し側 (cli.ts) が catch する想定で throw してよいが、
 * 「メモ保全に関わる」分岐 (intake 失敗 / push 失敗) は exit code を return する。
 */
export async function runAdd(
  input: string,
  opts?: { now?: Date; client?: AnthropicLike; config?: Config },
): Promise<number> {
  // 1. 入力ガード (T1.0 / ENG E9): 空入力は API 呼び出し前に reject。
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new RecallError({
      what: '入力が空です',
      cause: 'recall add に渡された本文が空白のみでした',
      memoStatus: '未保存 (API 呼び出し前に中断)',
      fix: 'recall add "保存したい本文" のように本文を渡してください',
    });
  }

  // 2. config 解決。
  const config = opts?.config ?? loadConfig();

  // 巨大入力は char 上限で先頭切り詰め (reject せず degrade)。切り詰めたら truncated。
  const maxChars = config.agent_max_input_tokens * CHARS_PER_TOKEN;
  let truncated = false;
  let body = input;
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    truncated = true;
  }

  // 3. API キー pre-flight (T1.9): client 注入時はキー解決をスキップ (テスト用)。
  const apiKey = opts?.client ? 'injected' : resolveApiKey(config);

  // 4. redaction (T1.4): 切り詰め後の body に対して最小 redaction。
  const redactedBody = redactSecrets(body);

  // 5. intake (T1.2/1.3)。失敗時は raw を failed-add.log に退避して exit 1 (T1.8 / ENG E7)。
  let intake;
  try {
    intake = await runIntake({
      body: redactedBody,
      apiKey,
      model: config.agent_model,
      maxOutputTokens: config.agent_max_output_tokens,
      recentSlugs: [],
      client: opts?.client,
      timeoutMs: INTAKE_TIMEOUT_MS,
    });
  } catch (err) {
    // raw な「元」input を退避 (redaction 前)。stderr には body を絶対に出さない。
    appendFailedAdd(input);
    const contract = new RecallError({
      what: 'メモの取り込み (要約生成) に失敗しました',
      cause: `LLM intake がエラーを返しました: ${err instanceof Error ? err.message : String(err)}`,
      memoStatus: `未保存。raw は ${failedAddLogPath()} に退避しました`,
      fix: '内容を確認し recall add で再実行してください',
    });
    process.stderr.write(contract.message + '\n');
    process.stderr.write(
      `Cause: ${contract.fields.cause}\nMemo status: ${contract.fields.memoStatus}\nFix: ${contract.fields.fix}\n`,
    );
    return 1;
  }

  // 6. wrapper (T1.5): slug / short_id / パス / captured_at / frontmatter 組み立て。
  const now = opts?.now ?? new Date();
  const slug = resolveSlug(intake.saveMemo.slug, now);

  const yyyy = String(now.getFullYear());
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const dirAbs = join(config.vault_path, yyyy, mm);

  // 書き込み前に existsSync で衝突チェック (ENG E1)。最終パスの存在で判定する。
  const shortId = generateUniqueShortId((id) =>
    existsSync(join(dirAbs, `${dd}-${slug}-${id}.md`)),
  );

  const fileName = `${dd}-${slug}-${shortId}.md`;
  const relPath = join(yyyy, mm, fileName);
  const finalPath = join(dirAbs, fileName);

  const capturedAt = toLocalIso8601(now);
  // source_id: captured_at の ":" を "-" に置換 + "-<short_id>" (filename-safe)。
  const sourceId = `${capturedAt.replace(/:/g, '-')}-${shortId}`;

  const frontmatter: Frontmatter = {
    source: 'manual',
    source_id: sourceId,
    captured_at: capturedAt,
    slug,
    short_id: shortId,
    tags: [],
    agent_summary: intake.saveMemo.agent_summary,
    agent_model: config.agent_model,
    truncated,
    deleted: false,
  };

  // 7. atomic write (T1.6 / ENG E11): 同一ディレクトリに .tmp を書いて renameSync で最終パスへ。
  const writeStart = Date.now();
  mkdirSync(dirAbs, { recursive: true });
  const content = serializeMemo(frontmatter, redactedBody);
  const tmpPath = join(dirAbs, `.${slug}-${shortId}.md.tmp`);
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, finalPath);
  const writeLatencyMs = Date.now() - writeStart;

  // 8. git add/commit (T1.7): local commit 成功 = CLI 成功。
  const commitStart = Date.now();
  gitAddCommit(config.vault_path, relPath, `add: ${slug}`);
  const commitLatencyMs = Date.now() - commitStart;

  // 9. push (T2.4): 失敗しても exit 0 のまま、stderr に remediation を出すだけ。
  const pushStart = Date.now();
  const push = gitPush(config.vault_path);
  const pushLatencyMs = push.ok ? Date.now() - pushStart : null;
  if (!push.ok) {
    process.stderr.write(
      `Warning: git push に失敗しました (メモは local に保存済み)。\n` +
        `  詳細: ${push.error ?? '(不明)'}\n` +
        `  手動で同期するには: git -C ${config.vault_path} push\n`,
    );
  }

  // 10. logging (T2.1/T2.3): 各 latency を記録。commit までの合計が閾値超なら警告。
  appendRecallLog({
    ts: new Date().toISOString(),
    action: 'add',
    slug,
    input_chars: input.length,
    agent_latency_ms: intake.latencyMs,
    write_latency_ms: writeLatencyMs,
    commit_latency_ms: commitLatencyMs,
    push_latency_ms: pushLatencyMs,
    quarantine_reason: intake.saveMemo.quarantine_reason,
  });

  const totalToCommitMs = intake.latencyMs + writeLatencyMs + commitLatencyMs;
  if (totalToCommitMs > SLOW_WARN_THRESHOLD_MS) {
    console.warn(
      `Note: commit までに ${totalToCommitMs}ms かかりました (${SLOW_WARN_THRESHOLD_MS}ms 超)。`,
    );
  }

  // 11. 成功: 保存先パスを stdout に出して exit 0。
  console.log(finalPath);
  return 0;
}
