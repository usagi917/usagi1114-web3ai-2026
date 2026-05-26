// recall mcp serve — search_memos を expose する MCP server (T3.1 / T3.4b)。
// name/description は toolDescription.ts のものを verbatim で共有 (ENG E6, 書き換え禁止)。
// 長時間走るプロセスなのでユニットテストはしない (MI1 で searchMemos を直接叩く)。cli.ts から呼べるよう export だけする。
import { appendFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.ts';
import { logsDir, servedSnippetsLogPath } from '../paths.ts';
import {
  SEARCH_MEMOS_DEFAULT_LIMIT,
  SEARCH_MEMOS_DESCRIPTION,
  SEARCH_MEMOS_NAME,
} from '../toolDescription.ts';
import { searchMemos } from '../search.ts';
import type { SearchResultItem } from '../types.ts';

/** served-snippets log に残す snippet の最大件数 (1 行あたり)。 */
const MAX_LOGGED_SNIPPETS = 5;

/**
 * served-snippets ロガー (T3.4b, CEO D)。results が空でないときだけ 1 行 append。
 * rotation は Phase 5 なのでここでは行わない (意図的に未実装)。
 */
async function logServedSnippets(query: string, results: SearchResultItem[]): Promise<void> {
  if (results.length === 0) return;
  try {
    // MCP 起動時 fallback として logs/ を mkdir -p。
    await mkdir(logsDir(), { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      query,
      results_count: results.length,
      // summary を優先し、無ければ snippet。最大 MAX_LOGGED_SNIPPETS 件。
      snippets: results
        .slice(0, MAX_LOGGED_SNIPPETS)
        .map((r) => (r.summary !== '' ? r.summary : r.snippet)),
    };
    await appendFile(servedSnippetsLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ロギング失敗は検索結果の返却を妨げない (best-effort)。
  }
}

/**
 * recall mcp serve のエントリ。config から vault_path を取り、search_memos を登録し stdio で待ち受ける。
 * config 無し等の起動失敗は stderr に分かりやすく出して rethrow する。
 */
export async function serveMcp(): Promise<void> {
  let vaultPath: string;
  try {
    vaultPath = loadConfig().vault_path;
  } catch (e) {
    // RecallError は人間可読 message を持つ。stderr に出して終了させる。
    process.stderr.write(
      `recall mcp serve を起動できません: ${(e as Error).message}\n`,
    );
    throw e;
  }

  const server = new McpServer({ name: 'recall', version: '0.1.0' });

  server.registerTool(
    SEARCH_MEMOS_NAME,
    {
      // description は verbatim 共有 (ENG E6)。
      description: SEARCH_MEMOS_DESCRIPTION,
      inputSchema: {
        query: z.string().describe('要件/テーマ/エラーメッセージ等'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`返す件数 (default ${SEARCH_MEMOS_DEFAULT_LIMIT})`),
      },
    },
    async ({ query, limit }) => {
      const results = await searchMemos({
        query,
        limit: limit ?? SEARCH_MEMOS_DEFAULT_LIMIT,
        vaultPath,
      });
      await logServedSnippets(query, results);
      // text content に結果 JSON を載せて返す (Claude Code が読む)。
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
