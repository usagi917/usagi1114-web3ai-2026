// user-facing 失敗の統一フォーマット (DX4)。
// 全 CLI コマンドの失敗は what / cause / memo status / fix の 4 行で出す。

export interface ErrorContractFields {
  /** 何が起きたか */
  what: string;
  /** なぜ起きたか */
  cause: string;
  /** メモがどこに保存された / されていないか */
  memoStatus: string;
  /** 次にすべき 1 コマンド or 行動 */
  fix: string;
}

/**
 * 契約付きエラー。CLI 境界で formatErrorContract して stderr に出し、exitCode で終了する。
 * MVP の exit code は 0=成功 / 1=失敗 の 2 値 (5 種規約は Phase 5)。
 */
export class RecallError extends Error {
  readonly fields: ErrorContractFields;
  readonly exitCode: number;

  constructor(fields: ErrorContractFields, exitCode = 1) {
    super(fields.what);
    this.name = 'RecallError';
    this.fields = fields;
    this.exitCode = exitCode;
  }
}

export function formatErrorContract(f: ErrorContractFields): string {
  return [
    `Error: ${f.what}`,
    `Cause: ${f.cause}`,
    `Memo status: ${f.memoStatus}`,
    `Fix: ${f.fix}`,
  ].join('\n');
}

/** RecallError なら契約フォーマット、そうでなければ message をそのまま返す */
export function renderError(err: unknown): string {
  if (err instanceof RecallError) {
    return formatErrorContract(err.fields);
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}

export function exitCodeOf(err: unknown): number {
  return err instanceof RecallError ? err.exitCode : 1;
}
