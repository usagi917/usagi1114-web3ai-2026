import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.ts';

// temp HOME (RECALL_HOME / RECALL_CLAUDE_MCP_PATH) で init を回す統合テスト。
// keychain チェックは環境依存なので「self-check が throw せず 0 で返る」ことだけ確認する。

let tmp: string;
let recallHome: string;
let mcpPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'recall-init-'));
  recallHome = join(tmp, 'recall-home');
  mcpPath = join(tmp, 'claude', 'mcp.json');
  savedEnv.RECALL_HOME = process.env.RECALL_HOME;
  savedEnv.RECALL_CLAUDE_MCP_PATH = process.env.RECALL_CLAUDE_MCP_PATH;
  savedEnv.RECALL_REPO_URL = process.env.RECALL_REPO_URL;
  process.env.RECALL_HOME = recallHome;
  process.env.RECALL_CLAUDE_MCP_PATH = mcpPath;
  delete process.env.RECALL_REPO_URL;
  // console 出力はテストノイズになるので抑制。
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ['RECALL_HOME', 'RECALL_CLAUDE_MCP_PATH', 'RECALL_REPO_URL'] as const) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('runInit (integration)', () => {
  it('config.json を生成し mcp.json に recall entry を入れて 0 を返す', async () => {
    const code = await runInit({ repoUrl: 'https://example.com/vault.git' });
    expect(code).toBe(0);

    // config.json が生成される。
    const cfgPath = join(recallHome, 'config.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    expect(cfg.repo_url).toBe('https://example.com/vault.git');
    expect(cfg.vault_path).toBe(join(recallHome, 'memo-vault'));

    // logs ディレクトリと vault (git repo) が作られる。
    expect(existsSync(join(recallHome, 'logs'))).toBe(true);
    expect(existsSync(join(recallHome, 'memo-vault', '.git'))).toBe(true);

    // mcp.json に recall entry。
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(mcp.mcpServers.recall.args).toEqual(['mcp', 'serve']);
    expect(typeof mcp.mcpServers.recall.command).toBe('string');
    expect(mcp.mcpServers.recall.command.length).toBeGreaterThan(0);
  });

  it('既存の他 server を保持する', async () => {
    mkdirSync(join(tmp, 'claude'), { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: { filesystem: { command: 'npx', args: ['fs'] } },
      }),
      'utf8',
    );
    const code = await runInit();
    expect(code).toBe(0);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(mcp.mcpServers.filesystem).toEqual({ command: 'npx', args: ['fs'] });
    expect(mcp.mcpServers.recall).toBeDefined();
  });

  it('再実行が idempotent (config 上書きせず, mcp 変更なし) で 0 を返す', async () => {
    await runInit();
    const cfgPath = join(recallHome, 'config.json');
    const cfgBefore = readFileSync(cfgPath, 'utf8');
    const mcpBefore = readFileSync(mcpPath, 'utf8');

    const code = await runInit();
    expect(code).toBe(0);
    // config.json は上書きされない。
    expect(readFileSync(cfgPath, 'utf8')).toBe(cfgBefore);
    // mcp.json も変わらない。
    expect(readFileSync(mcpPath, 'utf8')).toBe(mcpBefore);
  });

  it('self-check は keychain 未設定でも throw せず 0 を返す', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const code = await runInit();
    expect(code).toBe(0);
  });
});
