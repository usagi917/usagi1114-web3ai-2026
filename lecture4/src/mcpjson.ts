// mcp.json の merge 純粋ロジック (MU5, ENG E8)。
// 副作用なし。recall サーバーを追加しつつ他の server entry を保持する。
// 不正な JSON は絶対に上書きせず RecallError を投げる (E8)。
import { RecallError } from './errors.ts';

export interface McpServerEntry {
  command: string;
  args: string[];
}

/** 再帰的な deep-equal。JSON.stringify のキー順差異を避けるため自前実装。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}

/** 整形 JSON 文字列 (2-space indent, 末尾改行付き)。 */
function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * mcp.json に recall サーバーを merge する。
 * - existingRaw が null / 空白のみ → 新規作成 (changed: true)
 * - 有効な JSON → mcpServers.recall を set (他 server は保持)。
 *   既存 recall が新 entry と deep-equal なら no-op (changed: false)。
 * - 不正な JSON → RecallError を throw (上書きしない, E8)。
 */
export function mergeMcpConfig(
  existingRaw: string | null,
  recallEntry: McpServerEntry,
): { merged: string; changed: boolean } {
  // 新規作成ケース
  if (existingRaw === null || existingRaw.trim() === '') {
    return {
      merged: stringify({ mcpServers: { recall: recallEntry } }),
      changed: true,
    };
  }

  // 既存ファイルを parse。失敗時は上書きせず throw。
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch (e) {
    throw new RecallError({
      what: 'Claude Code の mcp.json が不正な JSON です',
      cause: `parse に失敗しました: ${(e as Error).message}`,
      memoStatus: '未保存 (mcp.json は変更していません)',
      fix: 'mcp.json を確認して JSON を修正してください (recall は絶対に上書きしません)',
    });
  }

  // object でなければ (配列 / プリミティブ) これも不正扱いとして上書きしない。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RecallError({
      what: 'Claude Code の mcp.json が不正な構造です',
      cause: 'トップレベルが JSON オブジェクトではありません',
      memoStatus: '未保存 (mcp.json は変更していません)',
      fix: 'mcp.json を確認してオブジェクト形式に修正してください (recall は絶対に上書きしません)',
    });
  }

  const root = parsed as Record<string, unknown>;
  const existingServersRaw = root.mcpServers;
  const servers: Record<string, unknown> =
    typeof existingServersRaw === 'object' &&
    existingServersRaw !== null &&
    !Array.isArray(existingServersRaw)
      ? { ...(existingServersRaw as Record<string, unknown>) }
      : {};

  // 既存 recall が完全一致なら idempotent (上書きしない)。
  if (deepEqual(servers.recall, recallEntry)) {
    return { merged: stringify(root), changed: false };
  }

  // recall を set (他 server は保持)。
  servers.recall = recallEntry;
  const merged = { ...root, mcpServers: servers };
  return { merged: stringify(merged), changed: true };
}
