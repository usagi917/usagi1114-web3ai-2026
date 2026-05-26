// recall CLI エントリポイント。サブコマンド分岐: add / mcp serve / init。
// human commands (add / init) と Claude Code 用 (mcp serve) を --help で分けて表示する (T1.1)。
import { runAdd } from './commands/add.ts';
import { runInit } from './commands/init.ts';
import { serveMcp } from './commands/mcpServe.ts';
import { renderError, exitCodeOf } from './errors.ts';

const HELP = `recall — ローカル memo vault + Claude Code 向け smart search (v0.1 MVP)

使い方:
  recall add [本文]          メモを要約・slug 化して vault に commit (本文省略時は stdin から読む)
  recall init                セットアップ (config 生成 / mcp.json merge / 依存チェック / self-check)
  recall mcp serve           Claude Code が起動する MCP server (search_memos を提供)
  recall --help              このヘルプ

例:
  recall add "prompt caching は 5 分 TTL でキャッシュされる"
  pbpaste | recall add
  recall init
`;

/** positional 引数が無ければ stdin を読む (DX6: pbpaste | recall add)。 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  switch (cmd) {
    case 'add': {
      const positional = rest.join(' ').trim();
      const input = positional.length > 0 ? positional : await readStdin();
      return runAdd(input);
    }
    case 'init': {
      const repoIdx = rest.indexOf('--repo-url');
      const repoUrl = repoIdx >= 0 ? rest[repoIdx + 1] : undefined;
      return runInit({ repoUrl });
    }
    case 'mcp': {
      if (rest[0] === 'serve') {
        await serveMcp();
        return 0; // serveMcp は通常常駐するためここには到達しない
      }
      process.stderr.write(`unknown subcommand: mcp ${rest[0] ?? ''}\n\n${HELP}`);
      return 1;
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(renderError(err) + '\n');
    process.exitCode = exitCodeOf(err);
  });
