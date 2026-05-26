// git.ts の unit テスト (ENG E5)。temp git repo を作り add/commit/push の挙動を検証する。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo, gitAddCommit, gitPush } from '../../src/git.ts';
import { RecallError } from '../../src/errors.ts';

let tmp: string;
let vault: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'recall-git-'));
  vault = join(tmp, 'vault');
  execFileSync('git', ['init', vault], { stdio: 'ignore' });
  execFileSync('git', ['-C', vault, 'config', 'user.email', 'test@example.com'], {
    stdio: 'ignore',
  });
  execFileSync('git', ['-C', vault, 'config', 'user.name', 'Recall Test'], {
    stdio: 'ignore',
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('isGitRepo', () => {
  it('git repo は true、非 repo は false', () => {
    expect(isGitRepo(vault)).toBe(true);
    expect(isGitRepo(tmp)).toBe(false);
  });
});

describe('gitAddCommit', () => {
  it('新規ファイルを add/commit して committed:true を返す', () => {
    writeFileSync(join(vault, 'a.md'), 'hello', 'utf8');
    const r = gitAddCommit(vault, 'a.md', 'add: a');
    expect(r.committed).toBe(true);
    const log = execFileSync('git', ['-C', vault, 'log', '--name-only', '--pretty=format:%s'], {
      encoding: 'utf8',
    });
    expect(log).toContain('add: a');
    expect(log).toContain('a.md');
  });

  it('path-scoped: 指定ファイルだけを commit し他の変更は含めない', () => {
    writeFileSync(join(vault, 'a.md'), 'A', 'utf8');
    writeFileSync(join(vault, 'b.md'), 'B', 'utf8');
    gitAddCommit(vault, 'a.md', 'add: a');
    const log = execFileSync('git', ['-C', vault, 'log', '--name-only', '--pretty=format:'], {
      encoding: 'utf8',
    });
    const files = log.split('\n').filter((l) => l.endsWith('.md'));
    expect(files).toEqual(['a.md']);
  });

  it('変更なし (nothing to commit) は committed:false を返しエラーにしない', () => {
    writeFileSync(join(vault, 'a.md'), 'A', 'utf8');
    gitAddCommit(vault, 'a.md', 'add: a');
    // 同じ内容で再 commit → nothing to commit。
    const r = gitAddCommit(vault, 'a.md', 'add: a again');
    expect(r.committed).toBe(false);
  });

  it('非 git ディレクトリでは RecallError を throw する', () => {
    writeFileSync(join(tmp, 'x.md'), 'x', 'utf8');
    expect(() => gitAddCommit(tmp, 'x.md', 'add: x')).toThrow(RecallError);
  });
});

describe('gitPush', () => {
  it('bogus remote への push は throw せず { ok:false } を返す', () => {
    execFileSync('git', ['-C', vault, 'remote', 'add', 'origin', '/nonexistent/repo.git'], {
      stdio: 'ignore',
    });
    writeFileSync(join(vault, 'a.md'), 'A', 'utf8');
    gitAddCommit(vault, 'a.md', 'add: a');
    const r = gitPush(vault);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});
