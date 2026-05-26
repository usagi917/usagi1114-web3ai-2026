// 最小 redaction (MU4)。MVP では api_key_generic 1 ルールのみで API キー類の値をマスクする。

/**
 * label (api_key / secret / token) + 区切り + 20 文字以上の値 にマッチする。
 * label と sep (区切り) は残し、value 部分だけを置換できるよう named group で分割する。
 */
const API_KEY_GENERIC =
  /(?<label>api[_-]?key|secret|token)(?<sep>["'\s:=]+)(?<val>[A-Za-z0-9_-]{20,})/gi;

/** 入力文字列中の API キー形式の値を `[REDACTED]` に置換する。label と sep は保持し、複数箇所も置換する。 */
export function redactSecrets(input: string): string {
  return input.replace(API_KEY_GENERIC, (_match, ...args) => {
    // replace の可変長引数末尾の groups オブジェクトから named group を取り出す。
    const groups = args[args.length - 1] as {
      label: string;
      sep: string;
      val: string;
    };
    return `${groups.label}${groups.sep}[REDACTED]`;
  });
}
