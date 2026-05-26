// memo Markdown の frontmatter シリアライズ / パース (MU3)。YAML はスキーマのキー順で出力する。
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Frontmatter } from '../types.ts';

/** frontmatter ブロックを取り出す正規表現。先頭の `---\n ... \n---` を捕捉する。 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Frontmatter を YAML + body の Markdown 文字列にシリアライズする。キー順はスキーマ定義順で固定。 */
export function serializeMemo(fm: Frontmatter, body: string): string {
  // スキーマのキー順を保証するため順序付きオブジェクトを明示的に組み立てる。
  const ordered = {
    source: fm.source,
    source_id: fm.source_id,
    captured_at: fm.captured_at,
    slug: fm.slug,
    short_id: fm.short_id,
    tags: fm.tags,
    agent_summary: fm.agent_summary,
    agent_model: fm.agent_model,
    truncated: fm.truncated,
    deleted: fm.deleted,
  };
  const yaml = stringifyYaml(ordered); // 末尾に改行を含む
  // body 末尾の改行を一旦剥がし、単一の末尾改行に正規化する。
  const trimmedBody = body.replace(/\n+$/, '');
  return `---\n${yaml}---\n\n${trimmedBody}\n`;
}

/** Markdown から frontmatter ブロックと body を分離する。区切りが無い不正入力は Error を throw。 */
export function parseMemo(content: string): { frontmatter: Frontmatter; body: string } {
  const match = FRONTMATTER_RE.exec(content);
  if (!match || match[1] === undefined) {
    throw new Error('frontmatter ブロック (--- で囲まれた YAML) が見つかりません');
  }
  const frontmatter = parseYaml(match[1]) as Frontmatter;
  // frontmatter ブロックを除いた残りを body とし、先頭の空行と serialize 由来の末尾改行を除去する。
  const body = content.slice(match[0].length).replace(/^\n+/, '').replace(/\n+$/, '');
  return { frontmatter, body };
}
