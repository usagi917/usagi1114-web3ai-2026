import { describe, it, expect } from 'vitest';
import { mergeMcpConfig } from '../../src/mcpjson.ts';
import type { McpServerEntry } from '../../src/mcpjson.ts';
import { RecallError } from '../../src/errors.ts';

const recallEntry: McpServerEntry = {
  command: '/abs/path/to/recall.mjs',
  args: ['mcp', 'serve'],
};

describe('mergeMcpConfig (MU5)', () => {
  it('null から新規作成する (changed: true)', () => {
    const { merged, changed } = mergeMcpConfig(null, recallEntry);
    expect(changed).toBe(true);
    const parsed = JSON.parse(merged);
    expect(parsed.mcpServers.recall).toEqual(recallEntry);
    // 2-space indent + 末尾改行。
    expect(merged.endsWith('\n')).toBe(true);
    expect(merged).toContain('\n  "mcpServers"');
  });

  it('空白のみの文字列からも新規作成する (changed: true)', () => {
    const { merged, changed } = mergeMcpConfig('   \n  ', recallEntry);
    expect(changed).toBe(true);
    expect(JSON.parse(merged).mcpServers.recall).toEqual(recallEntry);
  });

  it('既存の他 server (filesystem) を保持して recall を足す', () => {
    const existing = JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
    });
    const { merged, changed } = mergeMcpConfig(existing, recallEntry);
    expect(changed).toBe(true);
    const parsed = JSON.parse(merged);
    // 他 server が残っている。
    expect(parsed.mcpServers.filesystem).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    });
    // recall が追加されている。
    expect(parsed.mcpServers.recall).toEqual(recallEntry);
  });

  it('mcpServers が無いトップレベルキーを保持して mcpServers を作る', () => {
    const existing = JSON.stringify({ someOtherKey: { foo: 'bar' } });
    const { merged, changed } = mergeMcpConfig(existing, recallEntry);
    expect(changed).toBe(true);
    const parsed = JSON.parse(merged);
    expect(parsed.someOtherKey).toEqual({ foo: 'bar' });
    expect(parsed.mcpServers.recall).toEqual(recallEntry);
  });

  it('同一 entry で再実行すると idempotent (changed: false, 上書きしない)', () => {
    const existing = JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['x'] },
        recall: recallEntry,
      },
    });
    const { merged, changed } = mergeMcpConfig(existing, recallEntry);
    expect(changed).toBe(false);
    const parsed = JSON.parse(merged);
    expect(parsed.mcpServers.recall).toEqual(recallEntry);
    expect(parsed.mcpServers.filesystem).toEqual({ command: 'npx', args: ['x'] });
  });

  it('既存 recall が異なる entry なら上書きして changed: true', () => {
    const existing = JSON.stringify({
      mcpServers: { recall: { command: '/old/recall', args: ['mcp', 'serve'] } },
    });
    const { merged, changed } = mergeMcpConfig(existing, recallEntry);
    expect(changed).toBe(true);
    expect(JSON.parse(merged).mcpServers.recall).toEqual(recallEntry);
  });

  it('不正な JSON は RecallError を throw する (上書きしない, E8)', () => {
    const broken = '{ "mcpServers": { broken,,, }';
    expect(() => mergeMcpConfig(broken, recallEntry)).toThrow(RecallError);
  });

  it('トップレベルが配列など非オブジェクトなら RecallError を throw する', () => {
    expect(() => mergeMcpConfig('[1,2,3]', recallEntry)).toThrow(RecallError);
  });
});
