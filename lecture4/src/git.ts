// git 操作の薄いラッパ (ENG E5)。子プロセスは execFileSync の argv 配列で呼び、shell 補間は使わない。
// add/commit は path-scoped (並行 add の index 混線を防ぐ)、push は critical path 外 (CEO G)。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RecallError } from './errors.ts';

/** execFileSync の戻り値 (stdout+stderr 文字列) を保持した子プロセスエラー型の最小形。 */
interface ExecError extends Error {
  status: number | null;
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

/** Buffer | string | undefined を文字列に正規化する。 */
function toText(v: Buffer | string | undefined): string {
  if (v === undefined) return '';
  return typeof v === 'string' ? v : v.toString('utf8');
}

/** `<dir>/.git` の存在で git repo か判定する。 */
export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/**
 * path-scoped に add → commit する (T1.7 / ENG E5)。
 * - `git -C <vault> add -- <relPath>`
 * - `git -C <vault> commit --only -- <relPath> -m <message>`
 * commit が "nothing to commit" (変更なし) で非0終了した場合は committed:false を返しエラーにしない。
 * それ以外の本物の git 失敗は RecallError を throw する。
 */
export function gitAddCommit(
  vaultPath: string,
  relPath: string,
  message: string,
): { committed: boolean } {
  // add は失敗を素直に伝播させる (path-scoped index 投入)。
  try {
    execFileSync('git', ['-C', vaultPath, 'add', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as ExecError;
    throw new RecallError({
      what: 'git add に失敗しました',
      cause: toText(err.stderr) || err.message,
      memoStatus: `ファイルは書き込み済み (${relPath}) ですが commit されていません`,
      fix: `git -C ${vaultPath} status を確認してください`,
    });
  }

  // commit は path-scoped (--only) で対象ファイルだけを確定する。
  try {
    // -m はオプションなので `--` 区切りより前に置く (区切りの後は pathspec 扱い)。
    execFileSync(
      'git',
      ['-C', vaultPath, 'commit', '--only', '-m', message, '--', relPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { committed: true };
  } catch (e) {
    const err = e as ExecError;
    const combined = `${toText(err.stdout)}\n${toText(err.stderr)}`;
    // 変更が無い場合 (nothing to commit) はエラーにせず committed:false を返す。
    if (/nothing to commit|no changes added|nothing added to commit/i.test(combined)) {
      return { committed: false };
    }
    throw new RecallError({
      what: 'git commit に失敗しました',
      cause: combined.trim() || err.message,
      memoStatus: `ファイルは書き込み済み (${relPath}) ですが commit されていません`,
      fix: `git -C ${vaultPath} status を確認してください`,
    });
  }
}

/**
 * `git -C <vault> push` を実行する (T2.4 / CEO G)。
 * push は critical path 外なので失敗しても throw せず { ok:false, error } を返す。
 */
export function gitPush(vaultPath: string): { ok: boolean; error?: string } {
  try {
    execFileSync('git', ['-C', vaultPath, 'push'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (e) {
    const err = e as ExecError;
    const detail = (toText(err.stderr) || toText(err.stdout) || err.message).trim();
    return { ok: false, error: detail };
  }
}
