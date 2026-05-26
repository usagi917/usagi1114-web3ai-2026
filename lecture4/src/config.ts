// config.json の読み込み / 既定値生成 / API キー解決 (keychain or env)。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Config } from './types.ts';
import { configPath, defaultVaultPath, recallLogPath } from './paths.ts';
import { RecallError } from './errors.ts';

/** macOS Keychain の service / account。`security add-generic-password -s recall -a ANTHROPIC_API_KEY -w <key>` */
export const KEYCHAIN_SERVICE = 'recall';
export const KEYCHAIN_ACCOUNT = 'ANTHROPIC_API_KEY';

/** init が書き出す既定 config。vault_path / repo_url は呼び出し側が確定して渡す */
export function buildDefaultConfig(params: {
  vaultPath: string;
  repoUrl: string;
  model?: string;
}): Config {
  return {
    vault_path: params.vaultPath,
    repo_url: params.repoUrl,
    agent_model: params.model ?? 'claude-sonnet-4-6',
    agent_max_input_tokens: 8000,
    agent_max_output_tokens: 512,
    anthropic_api_key_source: 'keychain',
    log_path: recallLogPath(),
    pricing: { input_per_mtok_usd: 3.0, output_per_mtok_usd: 15.0 },
  };
}

/**
 * config.json を読む。無い / 壊れている場合は RecallError (fix に `recall init` を提示)。
 */
export function loadConfig(): Config {
  const path = configPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new RecallError({
      what: 'Recall の設定が見つかりません',
      cause: `${path} が存在しません`,
      memoStatus: '未保存 (処理は開始していません)',
      fix: 'recall init を実行してください',
    });
  }
  try {
    return JSON.parse(raw) as Config;
  } catch (e) {
    throw new RecallError({
      what: 'Recall の設定ファイルが不正な JSON です',
      cause: `${path} を parse できませんでした: ${(e as Error).message}`,
      memoStatus: '未保存 (処理は開始していません)',
      fix: `${path} を確認するか recall init で作り直してください`,
    });
  }
}

/**
 * Anthropic API キーを解決する。env (ANTHROPIC_API_KEY) を優先し、無ければ keychain。
 * 見つからない場合は API call 前の pre-flight で specific message を出すため RecallError を投げる (T1.9 / DX4)。
 */
export function resolveApiKey(config: Config): string {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  if (config.anthropic_api_key_source === 'keychain') {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
        // stderr は無視 (キー未登録時の "could not be found" ノイズを出さない)。
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const key = out.trim();
      if (key) return key;
    } catch {
      // fall through to error below
    }
  }

  throw new RecallError({
    what: 'Anthropic API キーを取得できません',
    cause: `keychain (service=${KEYCHAIN_SERVICE}, account=${KEYCHAIN_ACCOUNT}) にも環境変数 ANTHROPIC_API_KEY にも見つかりません`,
    memoStatus: '未保存 (API 呼び出し前に中断)',
    fix: `security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w <your-api-key>`,
  });
}
