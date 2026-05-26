// short_id の生成 (MU2) と existence-check リトライによる一意化 (ENG E1)。
import { randomBytes } from 'node:crypto';

/** 3 バイト乱数を hex 化して小文字 hex 6 文字の short_id を生成する。 */
export function generateShortId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * exists(id) が false (= 未使用) になるまで short_id を再生成して返す。
 * maxAttempts 回すべて衝突したら Error を throw する (デフォルト 50)。
 */
export function generateUniqueShortId(
  exists: (id: string) => boolean,
  maxAttempts = 50,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generateShortId();
    if (!exists(id)) return id;
  }
  throw new Error(`short_id を ${maxAttempts} 回試行しても一意化できませんでした`);
}
