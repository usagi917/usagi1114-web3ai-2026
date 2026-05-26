// パス解決の単一ソース。テストは RECALL_HOME / RECALL_CLAUDE_MCP_PATH を上書きして隔離する。
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `~/.recall` (テストは RECALL_HOME で上書き) */
export function recallHome(): string {
  return process.env.RECALL_HOME ?? join(homedir(), '.recall');
}

export function configPath(): string {
  return join(recallHome(), 'config.json');
}

export function defaultVaultPath(): string {
  return join(recallHome(), 'memo-vault');
}

export function logsDir(): string {
  return join(recallHome(), 'logs');
}

/** `recall add` 側の event log (append-only) */
export function recallLogPath(): string {
  return join(logsDir(), 'recall.jsonl');
}

/** `recall mcp serve` 側の served-snippets log (results_count>0 の時のみ) */
export function servedSnippetsLogPath(): string {
  return join(logsDir(), 'served-snippets.jsonl');
}

/** intake 失敗時の raw 保全先 (gitignore, local 専用)。stderr には body を出さない */
export function failedAddLogPath(): string {
  return join(recallHome(), 'failed-add.log');
}

/** Claude Code の MCP 設定 (テストは RECALL_CLAUDE_MCP_PATH で上書き) */
export function claudeMcpJsonPath(): string {
  return process.env.RECALL_CLAUDE_MCP_PATH ?? join(homedir(), '.claude', 'mcp.json');
}
