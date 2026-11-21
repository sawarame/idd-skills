#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchBotIdentity,
  fetchInstallationToken,
  loadBotConfig,
  parseOwnerAndRepo,
  resolveTargetRepository
} from './gh-as-bot.mjs';

const COMMIT_SUBCOMMANDS = new Set([
  'commit',
  'merge',
  'revert',
  'cherry-pick',
  'rebase',
  'am',
  'tag'
]);

const REMOTE_SUBCOMMANDS = new Set(['push', 'fetch', 'pull', 'ls-remote', 'clone']);

const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--exec-path',
  '--list-cmds'
]);

/**
 * `git` CLI に渡された引数配列を解析し、`-C` 作業ディレクトリ・サブコマンド・サブコマンド引数を抽出する関数
 * @param args - `git` に渡す引数配列
 * @param initialCwd - 初期作業ディレクトリ（省略時は `process.cwd()`）
 * @returns 解析結果オブジェクト（`cwd`, `subcommand`, `subcommandArgs`）
 */
export function parseGitCliArgs(args, initialCwd = process.cwd()) {
  let cwd = initialCwd;
  let subcommand = '';
  const subcommandArgs = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!subcommand) {
      if (arg === '--') {
        subcommandArgs.push(...args.slice(i + 1));
        break;
      }

      if (arg === '-C' && i + 1 < args.length) {
        cwd = path.resolve(cwd, args[i + 1]);
        i += 1;
        continue;
      }

      if (arg.startsWith('-C') && arg.length > 2) {
        cwd = path.resolve(cwd, arg.slice(2));
        continue;
      }

      if (GIT_OPTIONS_WITH_VALUE.has(arg) && i + 1 < args.length) {
        i += 1;
        continue;
      }

      if (arg.startsWith('-')) {
        continue;
      }

      subcommand = arg;
      continue;
    }

    subcommandArgs.push(arg);
  }

  return {
    cwd,
    subcommand,
    subcommandArgs
  };
}

/**
 * `git` サブコマンドの種類（コミット作成系 / リモート通信系 / その他）を判定する関数
 * @param subcommand - `git` のサブコマンド名
 * @returns 分類フラグオブジェクト（`isCommitCommand`, `isRemoteCommand`）
 */
export function classifyGitSubcommand(subcommand) {
  return {
    isCommitCommand: COMMIT_SUBCOMMANDS.has(subcommand),
    isRemoteCommand: REMOTE_SUBCOMMANDS.has(subcommand)
  };
}

/**
 * サブコマンド引数からリモート指定（リモート名または URL）を推定して対象 `owner/repo` と URL を解決する関数
 * @param subcommand - `git` サブコマンド名
 * @param subcommandArgs - サブコマンド以降の引数配列
 * @param cwd - 作業ディレクトリ
 * @returns 対象リポジトリ情報（`repo`, `remoteUrl`）
 */
export function resolveGitRemoteContext(subcommand, subcommandArgs, cwd = process.cwd()) {
  const positionals = [];
  for (let i = 0; i < subcommandArgs.length; i += 1) {
    const arg = subcommandArgs[i];
    if (arg === '--') {
      positionals.push(...subcommandArgs.slice(i + 1));
      break;
    }
    if (
      arg === '-o' ||
      arg === '--push-option' ||
      arg === '--repo' ||
      arg === '--receive-pack' ||
      arg === '--exec' ||
      arg === '--upload-pack' ||
      arg === '--depth' ||
      arg === '--shallow-since' ||
      arg === '--shallow-exclude' ||
      arg === '--negotiation-tip' ||
      arg === '-b' ||
      arg === '--branch' ||
      arg === '-j' ||
      arg === '--jobs'
    ) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    positionals.push(arg);
  }

  const candidate = subcommand === 'clone' ? positionals[0] : positionals[0];
  if (candidate) {
    const directRepo = parseOwnerAndRepo(candidate);
    if (directRepo) {
      return { repo: directRepo, remoteUrl: candidate };
    }

    // 引数がリモート名の場合は `git remote get-url` で URL を取得する
    const remoteCheck = spawnSync('git', ['remote', 'get-url', candidate], {
      encoding: 'utf8',
      cwd
    });
    if (remoteCheck.status === 0 && remoteCheck.stdout) {
      const remoteUrl = remoteCheck.stdout.trim();
      return {
        repo: parseOwnerAndRepo(remoteUrl),
        remoteUrl
      };
    }
  }

  const originCheck = spawnSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    cwd
  });
  const originUrl = originCheck.status === 0 ? originCheck.stdout.trim() : '';
  return {
    repo: resolveTargetRepository([], cwd),
    remoteUrl: originUrl
  };
}

/**
 * Bot 名義でコミットを作成するための Git 環境変数および `-c` オプションを構築する関数
 * @param botIdentity - `fetchBotIdentity` で取得した Bot の著者情報
 * @param baseEnv - ベースとなる環境変数オブジェクト
 * @returns Git グローバルオプション配列と環境変数オブジェクト
 */
export function buildBotCommitExecutionOptions(botIdentity, baseEnv = process.env) {
  const env = {
    ...baseEnv,
    GIT_AUTHOR_NAME: botIdentity.name,
    GIT_AUTHOR_EMAIL: botIdentity.email,
    GIT_COMMITTER_NAME: botIdentity.name,
    GIT_COMMITTER_EMAIL: botIdentity.email
  };

  // 個人のローカル署名設定（commit.gpgsign 等）によるエラーや署名不一致を防ぐため一時的に無効化する
  const globalArgs = ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
  return { globalArgs, env };
}

/**
 * Bot トークンで Git リモート通信を行うための環境変数および `-c` オプションを構築する関数
 * @param params - 設定パラメータ
 * @param params.botToken - GitHub App の Installation Access Token
 * @param params.askpassPath - 一時 `GIT_ASKPASS` スクリプトのパス
 * @param params.remoteUrl - 対象リモート URL（存在する場合）
 * @param params.baseEnv - ベースとなる環境変数オブジェクト
 * @returns Git グローバルオプション配列と環境変数オブジェクト
 */
export function buildBotRemoteExecutionOptions({
  botToken,
  askpassPath,
  remoteUrl = '',
  baseEnv = process.env
}) {
  const env = {
    ...baseEnv,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: askpassPath,
    IDD_GIT_BOT_TOKEN: botToken
  };

  // 既存の credential.helper（osxkeychain 等）をクリアし、SSH やユーザー名付き HTTPS URL を一時的に Bot 用 HTTPS へ書き換える
  const globalArgs = [
    '-c',
    'credential.helper=',
    '-c',
    'credential.username=x-access-token',
    '-c',
    'url.https://github.com/.insteadOf=git@github.com:',
    '-c',
    'url.https://github.com/.insteadOf=ssh://git@github.com/'
  ];

  // HTTPS URL に別ユーザー名が埋め込まれている場合（例: https://user@github.com/...）も安全に上書きする
  const userPrefixedHttps = remoteUrl.match(/^(https:\/\/[^@/]+@github\.com\/)/i);
  if (userPrefixedHttps) {
    globalArgs.push('-c', `url.https://github.com/.insteadOf=${userPrefixedHttps[1]}`);
  }

  return { globalArgs, env };
}

/**
 * `git` コマンドの失敗出力が Bot 認証またはリポジトリ権限不足に起因するかを判定する関数
 * @param outputText - 標準出力および標準エラー出力を結合した文字列
 * @returns 認証・権限エラーと判定される場合は true
 */
export function isGitAuthOrPermissionError(outputText) {
  if (!outputText) return false;
  return (
    /\b(?:401|403)\b/.test(outputText) ||
    /Permission to .* denied/i.test(outputText) ||
    /Write access to repository not granted/i.test(outputText) ||
    /Authentication failed/i.test(outputText) ||
    /could not read (?:Username|Password)/i.test(outputText) ||
    /terminal prompts disabled/i.test(outputText) ||
    /not accessible by integration/i.test(outputText) ||
    /Invalid username or token/i.test(outputText)
  );
}

/**
 * `GIT_ASKPASS` 用の一時スクリプトファイルを作成する関数
 * トークン自体はスクリプトに埋め込まず、環境変数 `IDD_GIT_BOT_TOKEN` を参照する
 * @returns 一時ディレクトリパス・スクリプトパス・削除用 `cleanup` 関数
 */
function createTempAskpassScript() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-as-bot-'));
  let scriptPath;

  if (process.platform === 'win32') {
    scriptPath = path.join(tempDir, 'askpass.cmd');
    const cmdContent = [
      '@echo off',
      'echo %~1 | findstr /I "username" >nul',
      'if %errorlevel%==0 (',
      '  echo x-access-token',
      ') else (',
      '  echo %IDD_GIT_BOT_TOKEN%',
      ')',
      ''
    ].join('\r\n');
    fs.writeFileSync(scriptPath, cmdContent, { encoding: 'utf8', mode: 0o700 });
  } else {
    scriptPath = path.join(tempDir, 'askpass.sh');
    const shContent = [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*|*username*)',
      '    printf "%s\\n" "x-access-token"',
      '    ;;',
      '  *)',
      '    printf "%s\\n" "$IDD_GIT_BOT_TOKEN"',
      '    ;;',
      'esac',
      ''
    ].join('\n');
    fs.writeFileSync(scriptPath, shContent, { encoding: 'utf8', mode: 0o700 });
    fs.chmodSync(scriptPath, 0o700);
  }

  return {
    tempDir,
    scriptPath,
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

/**
 * `git` コマンドを非同期実行し、出力をリアルタイムに親プロセスへ流しつつ結合出力と終了コードを返す関数
 * @param gitArgs - `git` に渡す完全な引数配列
 * @param env - 実行環境変数
 * @returns 終了コードと出力文字列を含むオブジェクト
 */
function runGitStreaming(gitArgs, env) {
  return new Promise(resolve => {
    const child = spawn('git', gitArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
      env
    });

    let combinedOutput = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      combinedOutput += text;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      combinedOutput += text;
      process.stderr.write(chunk);
    });

    child.on('error', err => {
      console.error(`[git-as-bot] Failed to start git command: ${err.message}`);
      resolve({ status: 1, output: err.message });
    });

    child.on('close', code => {
      resolve({
        status: typeof code === 'number' ? code : 1,
        output: combinedOutput
      });
    });
  });
}

/**
 * 通常のローカル `git` 設定・認証で `git` コマンドを実行する関数
 * @param args - 元の `git` CLI 引数配列
 * @returns 終了コード
 */
function runPlainGitCommand(args) {
  const result = spawnSync('git', args, {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    console.error(`[git-as-bot] Failed to start git command: ${result.error.message}`);
    return 1;
  }

  return typeof result.status === 'number' ? result.status : 1;
}

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
 * CLI のエントリポイント。Bot 設定の有無とサブコマンド種別に応じて Bot 名義コミット・Bot 認証プッシュを実行する関数
 * @returns 実行完了時に解決する Promise
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node git-as-bot.mjs <git-subcommand-and-args...>');
    process.exit(1);
  }

  const { cwd, subcommand, subcommandArgs } = parseGitCliArgs(args);
  const { isCommitCommand, isRemoteCommand } = classifyGitSubcommand(subcommand);

  // コミット系でもリモート通信系でもないローカルコマンドは即座に通常実行する
  if (!isCommitCommand && !isRemoteCommand) {
    process.exit(runPlainGitCommand(args));
  }

  let botConfig = null;
  try {
    botConfig = loadBotConfig();
  } catch (err) {
    console.warn(
      `[git-as-bot] Warning: ${err.message} Falling back to local git configuration.`
    );
  }

  if (!botConfig) {
    process.exit(runPlainGitCommand(args));
  }

  if (isCommitCommand) {
    try {
      const botIdentity = await fetchBotIdentity(botConfig);
      const { globalArgs, env } = buildBotCommitExecutionOptions(botIdentity);
      const result = await runGitStreaming([...globalArgs, ...args], env);
      process.exit(result.status);
    } catch (err) {
      console.warn(
        `[git-as-bot] Warning: Could not resolve Bot commit identity (${err.message}). Falling back to local git author configuration.`
      );
      process.exit(runPlainGitCommand(args));
    }
  }

  // リモート通信コマンド（push / fetch / pull 等）
  const remoteContext = resolveGitRemoteContext(subcommand, subcommandArgs, cwd);
  const repoArgs = remoteContext.repo
    ? ['-R', `${remoteContext.repo.owner}/${remoteContext.repo.repo}`]
    : [];

  let botToken = undefined;
  try {
    botToken = await fetchInstallationToken({
      ...botConfig,
      args: repoArgs,
      cwd
    });
  } catch (err) {
    console.warn(
      `[git-as-bot] Warning: Bot authentication failed (${err.message}). Falling back to local git credentials.`
    );
    process.exit(runPlainGitCommand(args));
  }

  const askpass = createTempAskpassScript();
  const { globalArgs, env } = buildBotRemoteExecutionOptions({
    botToken,
    askpassPath: askpass.scriptPath,
    remoteUrl: remoteContext.remoteUrl
  });

  // `pull` はマージコミットやリベースを伴うことがあるため、可能であれば Bot の著者情報も環境変数へ付与する
  let commitGlobalArgs = [];
  let effectiveEnv = env;
  if (subcommand === 'pull') {
    try {
      const botIdentity = await fetchBotIdentity({ ...botConfig, botToken });
      const commitOpts = buildBotCommitExecutionOptions(botIdentity, env);
      commitGlobalArgs = commitOpts.globalArgs;
      effectiveEnv = commitOpts.env;
    } catch {
      // Bot 著者情報の取得失敗時はリモート認証のみ継続する
    }
  }

  try {
    const result = await runGitStreaming([...commitGlobalArgs, ...globalArgs, ...args], effectiveEnv);

    if (result.status !== 0 && isGitAuthOrPermissionError(result.output)) {
      console.warn(
        '[git-as-bot] Warning: Bot git operation failed due to authentication or missing repository "Contents: Read and write" permission. Falling back to local git credentials.'
      );
      process.exit(runPlainGitCommand(args));
    }

    process.exit(result.status);
  } finally {
    askpass.cleanup();
  }
}

if (isDirectExecution()) {
  main();
}
