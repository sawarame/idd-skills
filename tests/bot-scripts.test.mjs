import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AI_POST_MARKER,
  AI_POST_MARKERS,
  annotateAiCommentBody,
  detectCommentLanguage,
  fetchBotIdentity,
  fetchInstallationToken,
  getAiPostMarker,
  isCommentApiCall,
  isCommentSubcommand,
  parseOwnerAndRepo,
  prepareCommentArgsForLocalUser,
  resolveTargetRepository
} from '../skills/idd-implement/scripts/gh-as-bot.mjs';
import {
  buildBotCommitExecutionOptions,
  buildBotRemoteExecutionOptions,
  classifyGitSubcommand,
  isGitAuthOrPermissionError,
  parseGitCliArgs,
  resolveGitRemoteContext
} from '../skills/idd-implement/scripts/git-as-bot.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const GIT_AS_BOT_PATH = path.join(REPO_ROOT, 'skills/idd-implement/scripts/git-as-bot.mjs');

/**
 * テスト用の一時ディレクトリを作成し、テスト終了時に自動削除するヘルパー関数
 * @param t - `node:test` のテストコンテキスト
 * @param prefix - 一時ディレクトリの接頭辞
 * @returns 作成した一時ディレクトリの絶対パス
 */
function createTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * テスト用の `git` コマンドを同期実行して成功をアサートするヘルパー関数
 * @param args - `git` 引数配列
 * @param cwd - 実行作業ディレクトリ
 * @param extraEnv - 追加環境変数
 * @returns 標準出力のトリム済み文字列
 */
function runGit(args, cwd, extraEnv = {}) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  assert.equal(
    res.status,
    0,
    `git ${args.join(' ')} failed (status=${res.status}):\n${res.stderr || res.stdout}`
  );
  return (res.stdout || '').trim();
}

test('parseGitCliArgs: -C やグローバルオプションを解釈して作業ディレクトリとサブコマンドを抽出する', () => {
  const baseDir = path.resolve('/tmp/workspace');
  const parsed1 = parseGitCliArgs(['commit', '-m', 'hello'], baseDir);
  assert.deepEqual(parsed1, {
    cwd: baseDir,
    subcommand: 'commit',
    subcommandArgs: ['-m', 'hello']
  });

  const parsed2 = parseGitCliArgs(
    ['-C', 'sub', '-C', 'nested', '-c', 'user.name=test', 'push', '-u', 'origin', 'main'],
    baseDir
  );
  assert.deepEqual(parsed2, {
    cwd: path.resolve(baseDir, 'sub', 'nested'),
    subcommand: 'push',
    subcommandArgs: ['-u', 'origin', 'main']
  });

  const parsed3 = parseGitCliArgs(['-C/var/tmp/repo', 'fetch', 'origin'], baseDir);
  assert.deepEqual(parsed3, {
    cwd: path.resolve('/var/tmp/repo'),
    subcommand: 'fetch',
    subcommandArgs: ['origin']
  });
});

test('classifyGitSubcommand: コミット系・リモート系・その他サブコマンドを正しく分類する', () => {
  for (const cmd of ['commit', 'merge', 'revert', 'cherry-pick', 'rebase', 'am', 'tag']) {
    assert.deepEqual(classifyGitSubcommand(cmd), {
      isCommitCommand: true,
      isRemoteCommand: false
    });
  }
  for (const cmd of ['push', 'fetch', 'pull', 'ls-remote', 'clone']) {
    assert.deepEqual(classifyGitSubcommand(cmd), {
      isCommitCommand: false,
      isRemoteCommand: true
    });
  }
  for (const cmd of ['status', 'add', 'diff', 'log', 'worktree', 'branch']) {
    assert.deepEqual(classifyGitSubcommand(cmd), {
      isCommitCommand: false,
      isRemoteCommand: false
    });
  }
});

test('buildBotCommitExecutionOptions: Bot の Author/Committer 環境変数と署名無効化オプションを構築する', () => {
  const result = buildBotCommitExecutionOptions(
    {
      name: 'my-agent[bot]',
      email: '987654+my-agent[bot]@users.noreply.github.com'
    },
    { PATH: '/usr/bin' }
  );

  assert.deepEqual(result.globalArgs, ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false']);
  assert.equal(result.env.GIT_AUTHOR_NAME, 'my-agent[bot]');
  assert.equal(result.env.GIT_AUTHOR_EMAIL, '987654+my-agent[bot]@users.noreply.github.com');
  assert.equal(result.env.GIT_COMMITTER_NAME, 'my-agent[bot]');
  assert.equal(result.env.GIT_COMMITTER_EMAIL, '987654+my-agent[bot]@users.noreply.github.com');
  assert.equal(result.env.PATH, '/usr/bin');
});

test('buildBotRemoteExecutionOptions: 既存 credential.helper を無効化し SSH/ユーザー名付き HTTPS を変換する', () => {
  const result = buildBotRemoteExecutionOptions({
    botToken: 'ghs_test_token',
    askpassPath: '/tmp/askpass.sh',
    remoteUrl: 'https://personal-user@github.com/owner/repo.git',
    baseEnv: { PATH: '/usr/bin' }
  });

  assert.equal(result.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(result.env.GIT_ASKPASS, '/tmp/askpass.sh');
  assert.equal(result.env.IDD_GIT_BOT_TOKEN, 'ghs_test_token');
  assert.ok(result.globalArgs.includes('credential.helper='));
  assert.ok(result.globalArgs.includes('credential.username=x-access-token'));
  assert.ok(result.globalArgs.includes('url.https://github.com/.insteadOf=git@github.com:'));
  assert.ok(result.globalArgs.includes('url.https://github.com/.insteadOf=ssh://git@github.com/'));
  assert.ok(
    result.globalArgs.includes(
      'url.https://github.com/.insteadOf=https://personal-user@github.com/'
    )
  );
});

test('isGitAuthOrPermissionError: 認証・権限エラーのみを検出し非認証エラーは false を返す', () => {
  assert.equal(
    isGitAuthOrPermissionError('remote: Permission to owner/repo.git denied to app[bot].'),
    true
  );
  assert.equal(
    isGitAuthOrPermissionError('remote: Write access to repository not granted.'),
    true
  );
  assert.equal(
    isGitAuthOrPermissionError('fatal: unable to access ...: The requested URL returned error: 403'),
    true
  );
  assert.equal(isGitAuthOrPermissionError('fatal: Authentication failed for ...'), true);
  assert.equal(
    isGitAuthOrPermissionError('! [rejected] main -> main (non-fast-forward)'),
    false
  );
  assert.equal(
    isGitAuthOrPermissionError('error: src refspec feat/missing does not match any'),
    false
  );
});

test('fetchBotIdentity & fetchInstallationToken: モック API と一時 RSA 鍵で Bot 識別情報とトークンを取得する', async t => {
  const tempDir = createTempDir(t, 'idd-bot-identity-');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const pemPath = path.join(tempDir, 'test-app.pem');
  fs.writeFileSync(pemPath, privateKey, 'utf8');

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calledUrls = [];
  globalThis.fetch = async url => {
    calledUrls.push(String(url));
    if (url === 'https://api.github.com/app') {
      return new Response(JSON.stringify({ id: 999, slug: 'idd-test-agent', name: 'IDD Agent' }), {
        status: 200
      });
    }
    if (url === 'https://api.github.com/users/idd-test-agent%5Bbot%5D') {
      return new Response(
        JSON.stringify({ id: 12345678, login: 'idd-test-agent[bot]', type: 'Bot' }),
        { status: 200 }
      );
    }
    if (url === 'https://api.github.com/repos/sawarame/idd-skills/installation') {
      return new Response(JSON.stringify({ id: 424242 }), { status: 200 });
    }
    if (url === 'https://api.github.com/app/installations/424242/access_tokens') {
      return new Response(JSON.stringify({ token: 'ghs_mocked_installation_token' }), {
        status: 200
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  const identity = await fetchBotIdentity({
    appId: '999',
    privateKeyPath: pemPath
  });
  assert.deepEqual(identity, {
    slug: 'idd-test-agent',
    userId: 12345678,
    name: 'idd-test-agent[bot]',
    email: '12345678+idd-test-agent[bot]@users.noreply.github.com'
  });

  const token = await fetchInstallationToken({
    appId: '999',
    privateKeyPath: pemPath,
    args: ['-R', 'sawarame/idd-skills']
  });
  assert.equal(token, 'ghs_mocked_installation_token');
  assert.ok(calledUrls.includes('https://api.github.com/app'));
  assert.ok(calledUrls.includes('https://api.github.com/users/idd-test-agent%5Bbot%5D'));
});

test('git-as-bot.mjs CLI: Bot 未設定時はローカル git 設定・認証へフォールバックして commit と push が成功する', t => {
  const tempDir = createTempDir(t, 'idd-git-fallback-');
  const bareRepo = path.join(tempDir, 'remote.git');
  const workRepo = path.join(tempDir, 'work');

  runGit(['init', '--bare', bareRepo], tempDir);
  runGit(['clone', bareRepo, workRepo], tempDir);
  runGit(['config', 'user.name', 'Local Tester'], workRepo);
  runGit(['config', 'user.email', 'local@example.com'], workRepo);
  runGit(['config', 'commit.gpgsign', 'false'], workRepo);
  runGit(['checkout', '-b', 'main'], workRepo);

  fs.writeFileSync(path.join(workRepo, 'hello.txt'), 'world\n', 'utf8');
  runGit(['add', 'hello.txt'], workRepo);

  const envWithoutBot = {
    ...process.env,
    GITHUB_APP_ENV_FILE: path.join(tempDir, 'nonexistent.env')
  };
  delete envWithoutBot.GITHUB_APP_ID;
  delete envWithoutBot.GITHUB_APP_PRIVATE_KEY_PATH;

  const commitRes = spawnSync(
    process.execPath,
    [GIT_AS_BOT_PATH, '-C', workRepo, 'commit', '-m', 'feat: initial commit'],
    { encoding: 'utf8', env: envWithoutBot }
  );
  assert.equal(
    commitRes.status,
    0,
    `git-as-bot commit failed:\n${commitRes.stderr || commitRes.stdout}`
  );

  const authorInfo = runGit(['log', '-1', '--format=%an <%ae>'], workRepo);
  assert.equal(authorInfo, 'Local Tester <local@example.com>');

  const pushRes = spawnSync(
    process.execPath,
    [GIT_AS_BOT_PATH, '-C', workRepo, 'push', '-u', 'origin', 'main'],
    { encoding: 'utf8', env: envWithoutBot }
  );
  assert.equal(
    pushRes.status,
    0,
    `git-as-bot push failed:\n${pushRes.stderr || pushRes.stdout}`
  );

  const remoteHead = runGit(['rev-parse', 'refs/heads/main'], bareRepo);
  const localHead = runGit(['rev-parse', 'HEAD'], workRepo);
  assert.equal(remoteHead, localHead);
});

test('resolveTargetRepository & resolveGitRemoteContext: -C 指定のリポジトリからリモートを解決できる', t => {
  const tempDir = createTempDir(t, 'idd-repo-resolve-');
  const repoDir = path.join(tempDir, 'sample');
  fs.mkdirSync(repoDir);
  runGit(['init'], repoDir);
  runGit(['remote', 'add', 'origin', 'git@github.com:sawarame/idd-skills.git'], repoDir);
  runGit(['remote', 'add', 'upstream', 'https://github.com/example/upstream-repo.git'], repoDir);

  assert.deepEqual(resolveTargetRepository([], repoDir), {
    owner: 'sawarame',
    repo: 'idd-skills'
  });
  assert.deepEqual(resolveGitRemoteContext('push', ['-u', 'upstream', 'main'], repoDir), {
    repo: { owner: 'example', repo: 'upstream-repo' },
    remoteUrl: 'https://github.com/example/upstream-repo.git'
  });
  assert.deepEqual(parseOwnerAndRepo('https://github.com/sawarame/idd-skills.git'), {
    owner: 'sawarame',
    repo: 'idd-skills'
  });
});

test('gh-as-bot.mjs: コメント本文の言語を判定しコードブロック内の日本語で誤判定しない', () => {
  assert.equal(detectCommentLanguage('### 仕様・機能要件\n実装します。'), 'ja');
  assert.equal(detectCommentLanguage('### 修正完了\n対応済'), 'ja');
  assert.equal(detectCommentLanguage('### Specifications & Functional Requirements\nDetails'), 'en');
  assert.equal(
    detectCommentLanguage(
      '### Summary\nUpdated `（🤖AIによる投稿）` handling.\n\n```js\n// 日本語コメント\nconst label = "テスト";\n```\n'
    ),
    'en'
  );
  assert.equal(getAiPostMarker('日本語コメント'), AI_POST_MARKERS.ja);
  assert.equal(getAiPostMarker('English comment'), AI_POST_MARKERS.en);
});

test('gh-as-bot.mjs: 言語別 AI 投稿マーク付与・重複防止・コメント判定のテスト', () => {
  // 日本語コメント（ATX 見出し / 見出しなし / 重複防止）
  assert.equal(
    annotateAiCommentBody('### 見出し\n本文'),
    `### 見出し${AI_POST_MARKER}\n本文`
  );
  assert.equal(
    annotateAiCommentBody('本文のみのコメント'),
    `${AI_POST_MARKERS.ja}\n\n本文のみのコメント`
  );
  assert.equal(
    annotateAiCommentBody(`### 見出し${AI_POST_MARKERS.ja}\n本文`),
    `### 見出し${AI_POST_MARKERS.ja}\n本文`
  );

  // 英語コメント（ATX 見出し / Setext 見出し / 見出しなし / 重複防止）
  assert.equal(
    annotateAiCommentBody('### Specifications & Functional Requirements\nDetails'),
    `### Specifications & Functional Requirements ${AI_POST_MARKERS.en}\nDetails`
  );
  assert.equal(
    annotateAiCommentBody('Summary\n---\nFixed the parser bug.'),
    `Summary ${AI_POST_MARKERS.en}\n---\nFixed the parser bug.`
  );
  assert.equal(
    annotateAiCommentBody('Fixed in abc1234.'),
    `${AI_POST_MARKERS.en}\n\nFixed in abc1234.`
  );
  assert.equal(
    annotateAiCommentBody(`### Summary ${AI_POST_MARKERS.en}\nDetails`),
    `### Summary ${AI_POST_MARKERS.en}\nDetails`
  );

  // ローカルフォールバック時の引数変換で英語マーカーが付与されること
  const prepared = prepareCommentArgsForLocalUser([
    'issue',
    'comment',
    '4',
    '--body',
    '### Summary\nDone.'
  ]);
  try {
    assert.deepEqual(prepared.args, [
      'issue',
      'comment',
      '4',
      '--body',
      `### Summary ${AI_POST_MARKERS.en}\nDone.`
    ]);
  } finally {
    prepared.cleanup();
  }

  assert.equal(isCommentSubcommand(['issue', 'comment', '4', '-b', 'hi']), true);
  assert.equal(
    isCommentApiCall(['api', 'repos/sawarame/idd-skills/pulls/1/comments/2/replies', '-f', 'body=ok']),
    true
  );
  assert.equal(
    isCommentApiCall(['api', '-X', 'GET', 'repos/sawarame/idd-skills/issues/4/comments']),
    false
  );
});
