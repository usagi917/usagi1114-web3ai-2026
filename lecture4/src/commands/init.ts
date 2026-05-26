// recall init — セットアップのオーケストレーション (T3.3 / T3.4 / T3.4c / DX2,DX3)。
// 依存チェック → config.json 生成 → mcp.json merge → logs/vault 作成 → self-check + smoke 手順表示。
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecallError } from '../errors.ts';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, buildDefaultConfig } from '../config.ts';
import {
  claudeMcpJsonPath,
  configPath,
  defaultVaultPath,
  logsDir,
  recallHome,
} from '../paths.ts';
import { mergeMcpConfig } from '../mcpjson.ts';

/** which 相当。見つからなければ null。 */
function which(cmd: string): string | null {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * mcp.json の command に書く recall の絶対パスを解決する。
 * PATH 上に recall があればそれを、無ければこの bin の絶対パス (bin/recall.mjs) を fallback。
 */
export function resolveRecallCommandPath(): string {
  const fromPath = which('recall');
  if (fromPath) return fromPath;
  // src/commands/init.ts から見て ../../bin/recall.mjs。
  return fileURLToPath(new URL('../../bin/recall.mjs', import.meta.url));
}

/** tmp ファイルに書いてから rename する atomic write。 */
function atomicWrite(targetPath: string, content: string): void {
  const tmp = join(dirname(targetPath), `.${'tmp'}-${Date.now()}-${process.pid}`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, targetPath);
}

/** ファイルが実行可能か。 */
function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** keychain に API キーが実際に読めるか (assume しない)。 */
function keychainHasApiKey(): boolean {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-w', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
      // stderr は捨てる (未設定時の "could not be found" ノイズを抑制)。
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** vault がすでに git repo か (`<vault>/.git` 存在)。 */
function isGitRepo(vault: string): boolean {
  return existsSync(join(vault, '.git'));
}

export async function runInit(opts?: { repoUrl?: string }): Promise<number> {
  // 1. 依存チェック: ripgrep (rg)。無ければ RecallError。
  const rgPath = which('rg');
  if (!rgPath) {
    throw new RecallError({
      what: 'ripgrep (rg) が見つかりません',
      cause: 'recall の検索は rg に依存しますが PATH 上に存在しません',
      memoStatus: '未保存 (セットアップを中断しました)',
      fix: 'brew install ripgrep',
    });
  }

  // 2. recall コマンドの絶対パスを解決 (mcp.json の command に使う)。
  const recallCmd = resolveRecallCommandPath();

  // 3. ~/.recall と logs ディレクトリ作成。
  mkdirSync(logsDir(), { recursive: true });
  console.log(`✓ Recall home: ${recallHome()}`);

  // 4. vault: 無ければ作成して git init。既に git repo ならスキップ。
  const vault = defaultVaultPath();
  if (!isGitRepo(vault)) {
    mkdirSync(vault, { recursive: true });
    execFileSync('git', ['init', vault], { stdio: 'ignore' });
    console.log(`✓ Vault を初期化しました: ${vault}`);
  } else {
    console.log(`✓ Vault は既に git repo です: ${vault}`);
  }

  // 5. config.json 生成。既存ならスキップ (上書きしない)。
  const cfgPath = configPath();
  if (existsSync(cfgPath)) {
    console.log(`✓ config.json は既に存在します (スキップ): ${cfgPath}`);
  } else {
    const repoUrl = opts?.repoUrl ?? process.env.RECALL_REPO_URL ?? '';
    const config = buildDefaultConfig({ vaultPath: vault, repoUrl });
    atomicWrite(cfgPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`✓ config.json を作成しました: ${cfgPath}`);
  }

  // 6. mcp.json merge。
  const mcpPath = claudeMcpJsonPath();
  let existingRaw: string | null = null;
  try {
    existingRaw = readFileSync(mcpPath, 'utf8');
  } catch {
    existingRaw = null;
  }
  // 不正 JSON の RecallError はそのまま伝播 (上書きしない, E8)。
  const { merged, changed } = mergeMcpConfig(existingRaw, {
    command: recallCmd,
    args: ['mcp', 'serve'],
  });
  if (changed) {
    mkdirSync(dirname(mcpPath), { recursive: true });
    atomicWrite(mcpPath, merged);
    console.log(`✓ mcp.json に recall サーバーを書き込みました: ${mcpPath}`);
  } else {
    console.log(`✓ mcp.json の recall エントリは最新です (変更なし): ${mcpPath}`);
  }

  // 7. self-check + smoke (T3.4c, DX2/3)。各項目は throw せず ✓ / ✗ で続行。
  console.log('\nSelf-check:');
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');

  console.log(`  ${mark(true)} ripgrep (rg): ${rgPath}`);

  const apiKeyOk = Boolean(process.env.ANTHROPIC_API_KEY?.trim()) || keychainHasApiKey();
  console.log(
    `  ${mark(apiKeyOk)} Anthropic API キー: ${
      apiKeyOk
        ? '利用可能 (env or keychain)'
        : `未設定 — security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w <your-api-key>`
    }`,
  );

  const recallCmdOk = existsSync(recallCmd) && isExecutable(recallCmd);
  console.log(`  ${mark(recallCmdOk)} recall 実行ファイル: ${recallCmd}`);

  const vaultOk = isGitRepo(vault);
  console.log(`  ${mark(vaultOk)} Vault は git repo: ${vault}`);

  // 8. blocking メッセージ + 公式 smoke 手順 (DX2/3)。
  console.log('\n────────────────────────────────────────');
  console.log('Restart Claude Code now. Until restart, search_memos is not available.');
  console.log('────────────────────────────────────────');
  console.log('\nSmoke test 手順:');
  console.log('  1. recall add "Recall smoke test: <任意の覚え書き>"');
  console.log('  2. Claude Code を再起動する');
  console.log('  3. Claude Code で「保存した smoke test メモは?」と聞き、search_memos が発火することを確認する');

  return 0;
}
