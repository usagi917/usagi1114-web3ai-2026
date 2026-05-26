// slug の検証 / fallback 生成 / 解決 (MU1)。filename-safe な slug を保証する純粋関数群。

/** slug の許容パターン: 小文字英数 + ハイフン, 1〜60 文字 */
const SLUG_PATTERN = /^[a-z0-9-]{1,60}$/;

/** candidate が slug 規約 `^[a-z0-9-]{1,60}$` に一致するか判定する。 */
export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

/** now のローカル時刻から `memo-YYYYMMDD-HHMMSS` 形式の fallback slug を生成する (ゼロ埋め)。 */
export function fallbackSlug(now: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const date = `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `memo-${date}-${time}`;
}

/** candidate が valid ならそれを、NG なら now ベースの fallback slug を返す。 */
export function resolveSlug(candidate: string, now: Date): string {
  return isValidSlug(candidate) ? candidate : fallbackSlug(now);
}
