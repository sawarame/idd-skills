#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Expands home directory shorthand (`~`, `$HOME`, `${HOME}`) in a path string.
 * @param rawPath - Raw path string to expand
 * @returns Expanded path string
 */
function expandHome(rawPath) {
  const home = os.homedir();
  let expanded = rawPath.trim();
  if (expanded === '~') {
    return home;
  }
  if (expanded.startsWith('~/')) {
    expanded = path.join(home, expanded.slice(2));
  }
  return expanded.replace(/\$\{HOME\}|\$HOME/g, home);
}

/**
 * Reads a `.env` file and returns a key-value map.
 * Properly handles quotes, `export ` prefixes, and `#` comment lines.
 * @param filePath - Absolute path to the `.env` file
 * @returns Parsed environment variable map
 */
function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline trailing comments outside quotes
      const commentIdx = value.indexOf(' #');
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    result[key] = value;
  }

  return result;
}

/**
 * Encodes binary or string data into Base64URL format.
 * @param input - Data to encode
 * @returns Base64URL-encoded string
 */
function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generates a short-lived RS256 JWT for GitHub App authentication.
 * @param appId - GitHub App ID
 * @param privateKeyPem - Private key string in PEM format
 * @returns Signed JWT string
 */
function createAppJwt(appId, privateKeyPem) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // Set iat 60s in the past for clock skew and exp 9m in the future (under the 10m limit)
  const payload = toBase64Url(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 540,
      iss: String(appId)
    })
  );

  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = toBase64Url(signer.sign(privateKeyPem));

  return `${signingInput}.${signature}`;
}

/**
 * Extracts `{ owner, repo }` from a GitHub repository URL or `owner/repo` string.
 * @param value - Repository specifier string or remote URL
 * @returns Extracted `{ owner, repo }`, or `null` if unparseable
 */
function parseOwnerAndRepo(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.git$/i, '');

  // Direct `owner/repo` format
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    return { owner, repo };
  }

  // HTTPS / SSH remote URL format
  const match = trimmed.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/|$)/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  return null;
}

/**
 * Resolves the target `owner/repo` from CLI arguments or the current Git repository.
 * @param args - CLI arguments passed to `gh`
 * @param cwd - Git リモート探索の基準となる作業ディレクトリ
 * @returns Resolved `{ owner, repo }`, or `null` if not identifiable
 */
function resolveTargetRepository(args = [], cwd = process.cwd()) {
  // 1. Prioritize `-R` / `--repo` flags from CLI arguments
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '-R' || arg === '--repo') && args[i + 1]) {
      const parsed = parseOwnerAndRepo(args[i + 1]);
      if (parsed) return parsed;
    } else if (arg.startsWith('--repo=')) {
      const parsed = parseOwnerAndRepo(arg.slice(7));
      if (parsed) return parsed;
    }
  }

  // 2. Read from the current directory's `origin` remote URL
  const remoteOrigin = spawnSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    cwd
  });
  if (remoteOrigin.status === 0 && remoteOrigin.stdout) {
    const parsed = parseOwnerAndRepo(remoteOrigin.stdout);
    if (parsed) return parsed;
  }

  // 3. Fall back to the first available remote URL other than `origin`
  const remotes = spawnSync('git', ['remote'], { encoding: 'utf8', cwd });
  if (remotes.status === 0 && remotes.stdout) {
    const firstRemote = remotes.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    if (firstRemote) {
      const remoteUrl = spawnSync('git', ['remote', 'get-url', firstRemote], {
        encoding: 'utf8',
        cwd
      });
      if (remoteUrl.status === 0 && remoteUrl.stdout) {
        const parsed = parseOwnerAndRepo(remoteUrl.stdout);
        if (parsed) return parsed;
      }
    }
  }

  return null;
}

/**
 * Sends a request to the GitHub REST API and returns the JSON response.
 * @param url - Request URL
 * @param method - HTTP method
 * @param bearerToken - 認証用トークン（JWT または Installation Access Token、省略時は無認証）
 * @returns Parsed JSON response object
 */
async function callGitHubAppApi(url, method, bearerToken) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'idd-skills-gh-as-bot',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(url, {
    method,
    headers
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`GitHub API error (${response.status} ${response.statusText}): ${bodyText}`);
  }

  return response.json();
}

/**
 * Acquires a GitHub App Installation Access Token for the target repository.
 * @param params - App configuration parameters
 * @param params.appId - GitHub App ID
 * @param params.privateKeyPath - Path to the private key `.pem` file
 * @param params.installationId - Fixed Installation ID (auto-detected from repository when omitted)
 * @param params.args - CLI argument list passed to `gh`
 * @param params.cwd - Git リモート解決時の作業ディレクトリ
 * @returns Acquired Installation Access Token
 */
async function fetchInstallationToken({
  appId,
  privateKeyPath,
  installationId,
  args = [],
  cwd = process.cwd()
}) {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key file not found: ${privateKeyPath}`);
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const jwt = createAppJwt(appId, privateKeyPem);

  let resolvedInstallationId = installationId;
  if (!resolvedInstallationId) {
    const targetRepo = resolveTargetRepository(args, cwd);
    if (!targetRepo) {
      throw new Error(
        'Could not identify the target repository (owner/repo). Run inside a repository or specify `-R owner/repo`.'
      );
    }

    const installUrl = `https://api.github.com/repos/${targetRepo.owner}/${targetRepo.repo}/installation`;
    try {
      const installInfo = await callGitHubAppApi(installUrl, 'GET', jwt);
      resolvedInstallationId = installInfo?.id ? String(installInfo.id) : '';
    } catch (err) {
      throw new Error(
        `Failed to retrieve GitHub App installation information for repository ${targetRepo.owner}/${targetRepo.repo} (verify the app is installed on this repository). Details: ${err.message}`
      );
    }
  }

  if (!resolvedInstallationId) {
    throw new Error('Could not resolve Installation ID.');
  }

  const tokenUrl = `https://api.github.com/app/installations/${resolvedInstallationId}/access_tokens`;
  const tokenData = await callGitHubAppApi(tokenUrl, 'POST', jwt);
  if (!tokenData?.token) {
    throw new Error('Installation Access Token response did not include a token.');
  }

  return tokenData.token;
}

/**
 * GitHub App の情報から Git コミット用の Bot ユーザー名・noreply メールアドレスを取得する関数
 * @param params - App 認証パラメータ
 * @param params.appId - GitHub App ID
 * @param params.privateKeyPath - 秘密鍵 `.pem` ファイルのパス
 * @param params.botToken - 取得済みの Installation Access Token（省略時は無認証で `/users` を照会）
 * @returns Bot の識別情報（`name`, `email`, `slug`, `userId`）
 */
async function fetchBotIdentity({ appId, privateKeyPath, botToken } = {}) {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key file not found: ${privateKeyPath}`);
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const jwt = createAppJwt(appId, privateKeyPem);

  const appInfo = await callGitHubAppApi('https://api.github.com/app', 'GET', jwt);
  if (!appInfo?.slug) {
    throw new Error('GitHub App metadata response did not include a slug.');
  }

  const expectedLogin = `${appInfo.slug}[bot]`;
  const userInfo = await callGitHubAppApi(
    `https://api.github.com/users/${encodeURIComponent(expectedLogin)}`,
    'GET',
    botToken
  );

  if (!userInfo?.id) {
    throw new Error(`Could not resolve GitHub user ID for ${expectedLogin}.`);
  }

  const login = userInfo.login || expectedLogin;
  return {
    slug: appInfo.slug,
    userId: userInfo.id,
    name: login,
    email: `${userInfo.id}+${login}@users.noreply.github.com`
  };
}

/**
 * Loads Bot configuration from `.env` or environment variables.
 * Returns `null` when the default `.env` does not exist, falling back to normal `gh` execution.
 * @returns Configuration object, or `null` when unconfigured
 */
function loadBotConfig() {
  const defaultEnvPath = path.join(os.homedir(), '.config', 'github-app', '.env');
  const envFilePath = process.env.GITHUB_APP_ENV_FILE
    ? expandHome(process.env.GITHUB_APP_ENV_FILE)
    : defaultEnvPath;

  const envFileExists = fs.existsSync(envFilePath);
  const fileVars = envFileExists ? parseEnvFile(envFilePath) : {};

  // When `.env` does not exist and env vars are unset, run as the locally authenticated gh user
  if (
    !envFileExists &&
    !(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY_PATH)
  ) {
    return null;
  }

  const appId = (fileVars.GITHUB_APP_ID || process.env.GITHUB_APP_ID || '').trim();
  const rawKeyPath = (
    fileVars.GITHUB_APP_PRIVATE_KEY_PATH ||
    process.env.GITHUB_APP_PRIVATE_KEY_PATH ||
    ''
  ).trim();
  const installationId = (
    fileVars.GITHUB_APP_INSTALLATION_ID ||
    process.env.GITHUB_APP_INSTALLATION_ID ||
    ''
  ).trim();

  if (!appId || !rawKeyPath) {
    throw new Error(
      `GitHub App config file (${envFilePath}) exists, but GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY_PATH is not set.`
    );
  }

  const expandedKeyPath = expandHome(rawKeyPath);
  const baseDir = envFileExists ? path.dirname(envFilePath) : process.cwd();
  const privateKeyPath = path.isAbsolute(expandedKeyPath)
    ? expandedKeyPath
    : path.resolve(baseDir, expandedKeyPath);

  return {
    appId,
    privateKeyPath,
    installationId
  };
}

/**
 * `gh` CLI 実行用の環境変数オブジェクトを構築する関数
 * @param botToken - Bot 認証トークン（通常実行時は未指定）
 * @returns 子プロセスへ渡す環境変数マップ
 */
export function buildGhEnv(botToken) {
  const childEnv = { ...process.env };
  if (botToken) {
    // 既存のトークン環境変数を上書きし、確実に Bot トークンで実行する
    delete childEnv.GITHUB_TOKEN;
    childEnv.GH_TOKEN = botToken;
  }
  return childEnv;
}

/**
 * Executes the `gh` CLI with the specified arguments and propagates its exit code.
 * @param args - Argument array passed to `gh`
 * @param botToken - Bot authentication token (omitted during standard execution)
 * @returns Exit code of the `gh` process
 */
function runGhCommand(args, botToken) {
  const childEnv = buildGhEnv(botToken);

  const result = spawnSync('gh', args, {
    stdio: 'inherit',
    env: childEnv
  });

  if (result.error) {
    console.error(`[gh-as-bot] Failed to start gh command: ${result.error.message}`);
    return 1;
  }

  return typeof result.status === 'number' ? result.status : 1;
}

const AI_POST_MARKER = '（🤖AIによる投稿）';

/**
 * コメント本文の最初の見出しの直後に AI 投稿マークを付与する関数
 * @param body - 元のコメント本文
 * @returns AI 投稿マーク付与後のコメント本文
 */
export function annotateAiCommentBody(body) {
  if (typeof body !== 'string' || body.length === 0) {
    return body;
  }

  // すでに AI 投稿マークが含まれている場合は重複付与しない
  if (body.includes(AI_POST_MARKER)) {
    return body;
  }

  const lineBreak = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);

  let activeFenceChar = '';
  let activeFenceLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // フェンスコードブロック内の `#` コメントを見出しとして誤認しないようスキップする
    if (activeFenceChar) {
      const closeMatch = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === activeFenceChar &&
        closeMatch[1].length >= activeFenceLength
      ) {
        activeFenceChar = '';
        activeFenceLength = 0;
      }
      continue;
    }

    const openMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (openMatch) {
      const fence = openMatch[1];
      const info = openMatch[2];
      // CommonMark 仕様上、バッククォートフェンスの info 文字列にはバッククォートを含めない
      if (!(fence[0] === '`' && info.includes('`'))) {
        activeFenceChar = fence[0];
        activeFenceLength = fence.length;
        continue;
      }
    }

    // ATX 見出し（# 〜 ######）を検出して見出しテキスト直後にマークを付与する
    const atxMatch = line.match(/^(\s{0,3}#{1,6}[ \t]+.*?\S)([ \t]+#+)?([ \t]*)$/);
    if (atxMatch) {
      lines[i] = `${atxMatch[1]}${AI_POST_MARKER}${atxMatch[2] || ''}${atxMatch[3] || ''}`;
      return lines.join(lineBreak);
    }

    // Setext 見出し（次行が === または ---）を検出する
    if (
      i + 1 < lines.length &&
      line.trim().length > 0 &&
      !/^\s{0,3}(?:>|#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|---+\s*$|===+\s*$)/.test(line) &&
      /^\s{0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1])
    ) {
      lines[i] = `${line.replace(/[ \t]+$/, '')}${AI_POST_MARKER}`;
      return lines.join(lineBreak);
    }
  }

  // 見出しが存在しない場合は先頭に AI 投稿マークを補う
  return `${AI_POST_MARKER}${lineBreak}${lineBreak}${body}`;
}

/**
 * `gh` CLI 引数から先頭の位置引数を抽出する関数
 * @param args - `gh` CLI に渡す引数配列
 * @param maxCount - 取得する位置引数の最大数
 * @returns 抽出した位置引数の配列
 */
function extractPositionalArgs(args, maxCount = 2) {
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      break;
    }
    if (
      arg === '-R' ||
      arg === '--repo' ||
      arg === '-X' ||
      arg === '--method' ||
      arg === '-H' ||
      arg === '--header' ||
      arg === '-f' ||
      arg === '--raw-field' ||
      arg === '-F' ||
      arg === '--field'
    ) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    positional.push(arg);
    if (positional.length >= maxCount) {
      break;
    }
  }
  return positional;
}

/**
 * `gh` CLI 引数がコメント投稿サブコマンド（`issue comment` / `pr comment` / `pr review`）かを判定する関数
 * @param args - `gh` CLI に渡す引数配列
 * @returns コメント投稿サブコマンドの場合は true
 */
export function isCommentSubcommand(args) {
  const positional = extractPositionalArgs(args, 2);
  if (positional[0] === 'issue' && positional[1] === 'comment') {
    return true;
  }
  if (positional[0] === 'pr' && (positional[1] === 'comment' || positional[1] === 'review')) {
    return true;
  }
  return false;
}

/**
 * `gh api` 呼び出しがコメントまたはレビュー投稿エンドポイントへの書き込みかを判定する関数
 * @param args - `gh` CLI に渡す引数配列
 * @returns コメント投稿 API 呼び出しの場合は true
 */
export function isCommentApiCall(args) {
  const positional = extractPositionalArgs(args, 2);
  if (positional[0] !== 'api' || !positional[1]) {
    return false;
  }

  // 明示的に GET が指定されている場合は読み取り専用とみなす
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if ((arg === '-X' || arg === '--method') && args[i + 1]) {
      if (args[i + 1].trim().toUpperCase() === 'GET') return false;
      i += 1;
    } else if (arg.startsWith('--method=') && arg.slice(9).trim().toUpperCase() === 'GET') {
      return false;
    } else if (arg.startsWith('-X') && arg.length > 2 && arg.slice(2).trim().toUpperCase() === 'GET') {
      return false;
    }
  }

  const endpoint = positional[1].replace(/^\/+/, '').split('?')[0];
  return /^repos\/[^/]+\/[^/]+\/(?:issues\/\d+\/comments|pulls\/\d+\/comments(?:\/\d+\/replies)?|pulls\/\d+\/reviews)$/.test(
    endpoint
  );
}

/**
 * ファイルまたは標準入力から本文を読み込み、AI 投稿マークを付与した一時ファイルを作成する関数
 * @param sourcePath - 元の本文ファイルパス（`-` の場合は標準入力）
 * @param tempDirs - クリーンアップ対象の一時ディレクトリ配列
 * @returns 一時ファイルのパス（読み込み失敗時は null）
 */
function createAnnotatedBodyTempFile(sourcePath, tempDirs) {
  try {
    const rawContent =
      sourcePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(sourcePath, 'utf8');
    const annotated = annotateAiCommentBody(rawContent);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-as-bot-'));
    tempDirs.push(tempDir);
    const tempFile = path.join(tempDir, 'comment-body.md');
    fs.writeFileSync(tempFile, annotated, 'utf8');
    return tempFile;
  } catch {
    return null;
  }
}

/**
 * `gh api` の `body=...` フィールド値へ AI 投稿マークを付与する関数
 * @param fieldArg - `body=...` 形式のフィールド文字列
 * @param allowFileRef - `@filepath` 形式のファイル参照を解釈するか（`-F` / `--field` の場合 true）
 * @param tempDirs - クリーンアップ対象の一時ディレクトリ配列
 * @returns 変換後の `body=...` 文字列（対象外の場合は null）
 */
function annotateApiBodyField(fieldArg, allowFileRef, tempDirs) {
  if (!fieldArg.startsWith('body=')) {
    return null;
  }
  const value = fieldArg.slice(5);
  if (allowFileRef && value.startsWith('@')) {
    const tempFile = createAnnotatedBodyTempFile(value.slice(1), tempDirs);
    return tempFile ? `body=@${tempFile}` : null;
  }
  return `body=${annotateAiCommentBody(value)}`;
}

/**
 * ローカルユーザーでのフォールバック実行向けに、コメント投稿引数の本文へ AI 投稿マークを付与する関数
 * @param args - 元の `gh` CLI 引数配列
 * @returns 変換後の引数配列と一時ファイル削除用の `cleanup` 関数を含むオブジェクト
 */
export function prepareCommentArgsForLocalUser(args) {
  const isSubcommand = isCommentSubcommand(args);
  const isApiCall = !isSubcommand && isCommentApiCall(args);
  if (!isSubcommand && !isApiCall) {
    return { args, cleanup: () => {} };
  }

  const nextArgs = [...args];
  const tempDirs = [];

  for (let i = 0; i < nextArgs.length; i += 1) {
    const arg = nextArgs[i];
    if (arg === '--') {
      break;
    }
    if (arg === '-R' || arg === '--repo') {
      i += 1;
      continue;
    }

    if (isApiCall) {
      if ((arg === '-f' || arg === '--raw-field') && i + 1 < nextArgs.length) {
        const updated = annotateApiBodyField(nextArgs[i + 1], false, tempDirs);
        if (updated) nextArgs[i + 1] = updated;
        i += 1;
        continue;
      }
      if ((arg === '-F' || arg === '--field') && i + 1 < nextArgs.length) {
        const updated = annotateApiBodyField(nextArgs[i + 1], true, tempDirs);
        if (updated) nextArgs[i + 1] = updated;
        i += 1;
        continue;
      }
      for (const [prefix, allowFileRef] of [
        ['--raw-field=', false],
        ['-f=', false],
        ['--field=', true],
        ['-F=', true]
      ]) {
        if (arg.startsWith(prefix)) {
          const updated = annotateApiBodyField(arg.slice(prefix.length), allowFileRef, tempDirs);
          if (updated) nextArgs[i] = `${prefix}${updated}`;
          break;
        }
      }
      continue;
    }

    if ((arg === '--body' || arg === '-b') && i + 1 < nextArgs.length) {
      nextArgs[i + 1] = annotateAiCommentBody(nextArgs[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--body=')) {
      nextArgs[i] = `--body=${annotateAiCommentBody(arg.slice(7))}`;
      continue;
    }
    if (arg.startsWith('-b=')) {
      nextArgs[i] = `-b=${annotateAiCommentBody(arg.slice(3))}`;
      continue;
    }

    if ((arg === '--body-file' || arg === '-F') && i + 1 < nextArgs.length) {
      const tempFile = createAnnotatedBodyTempFile(nextArgs[i + 1], tempDirs);
      if (tempFile) {
        nextArgs[i + 1] = tempFile;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--body-file=')) {
      const tempFile = createAnnotatedBodyTempFile(arg.slice(12), tempDirs);
      if (tempFile) {
        nextArgs[i] = `--body-file=${tempFile}`;
      }
      continue;
    }
    if (arg.startsWith('-F=')) {
      const tempFile = createAnnotatedBodyTempFile(arg.slice(3), tempDirs);
      if (tempFile) {
        nextArgs[i] = `-F=${tempFile}`;
      }
      continue;
    }
  }

  return {
    args: nextArgs,
    cleanup: () => {
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  };
}

export {
  AI_POST_MARKER,
  callGitHubAppApi,
  createAppJwt,
  fetchBotIdentity,
  fetchInstallationToken,
  loadBotConfig,
  parseOwnerAndRepo,
  resolveTargetRepository
};

/**
 * 現在のスクリプトが CLI のエントリポイントとして直接実行されているかを判定する関数
 * @returns 直接実行されている場合は true、モジュールとしてインポートされた場合は false
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    const selfPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const entryPath = fs.realpathSync(process.argv[1]);
    return selfPath === entryPath;
  } catch {
    return false;
  }
}

/**
 * CLI のエントリポイント。Bot 認証を試行し、設定未定義または認証失敗時はローカル gh ユーザーへフォールバックする関数
 * @returns 実行完了時に解決する Promise
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node gh-as-bot.mjs <gh-subcommand-and-args...>');
    process.exit(1);
  }

  let botConfig = null;
  try {
    botConfig = loadBotConfig();
  } catch (err) {
    console.warn(
      `[gh-as-bot] Warning: ${err.message} Falling back to locally authenticated gh user.`
    );
  }

  let botToken = undefined;
  if (botConfig) {
    try {
      botToken = await fetchInstallationToken({ ...botConfig, args });
    } catch (err) {
      console.warn(
        `[gh-as-bot] Warning: Bot authentication failed (${err.message}). Falling back to locally authenticated gh user.`
      );
    }
  }

  if (!botToken) {
    // GitHub App の情報がない場合や認証に失敗した場合は、ローカルでログイン中の gh ユーザーとして実行する
    const { args: fallbackArgs, cleanup } = prepareCommentArgsForLocalUser(args);
    try {
      const exitCode = runGhCommand(fallbackArgs, undefined);
      process.exit(exitCode);
    } finally {
      cleanup();
    }
  }

  const exitCode = runGhCommand(args, botToken);
  process.exit(exitCode);
}

if (isDirectExecution()) {
  main();
}
