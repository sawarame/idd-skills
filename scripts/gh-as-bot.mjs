#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
 * @returns Resolved `{ owner, repo }`, or `null` if not identifiable
 */
function resolveTargetRepository(args) {
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
    encoding: 'utf8'
  });
  if (remoteOrigin.status === 0 && remoteOrigin.stdout) {
    const parsed = parseOwnerAndRepo(remoteOrigin.stdout);
    if (parsed) return parsed;
  }

  // 3. Fall back to the first available remote URL other than `origin`
  const remotes = spawnSync('git', ['remote'], { encoding: 'utf8' });
  if (remotes.status === 0 && remotes.stdout) {
    const firstRemote = remotes.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    if (firstRemote) {
      const remoteUrl = spawnSync('git', ['remote', 'get-url', firstRemote], {
        encoding: 'utf8'
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
 * @param jwt - JWT for GitHub App authentication
 * @returns Parsed JSON response object
 */
async function callGitHubAppApi(url, method, jwt) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'User-Agent': 'idd-skills-gh-as-bot',
      'X-GitHub-Api-Version': '2022-11-28'
    }
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
 * @returns Acquired Installation Access Token
 */
async function fetchInstallationToken({ appId, privateKeyPath, installationId, args }) {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key file not found: ${privateKeyPath}`);
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const jwt = createAppJwt(appId, privateKeyPem);

  let resolvedInstallationId = installationId;
  if (!resolvedInstallationId) {
    const targetRepo = resolveTargetRepository(args);
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
 * Executes the `gh` CLI with the specified arguments and propagates its exit code.
 * @param args - Argument array passed to `gh`
 * @param botToken - Bot authentication token (omitted during standard execution)
 * @returns Exit code of the `gh` process
 */
function runGhCommand(args, botToken) {
  const childEnv = { ...process.env };
  if (botToken) {
    // Prevent existing env token overrides and ensure execution uses the Bot token
    delete childEnv.GITHUB_TOKEN;
    childEnv.GH_TOKEN = botToken;
  }

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

/**
 * Entry point. Switches authentication mode based on Bot configuration and executes `gh`.
 * @returns Promise resolving when execution completes
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
    console.error(`[gh-as-bot] Configuration error: ${err.message}`);
    process.exit(1);
  }

  if (!botConfig) {
    // When `.env` is not configured, run as the locally logged-in GitHub user
    const exitCode = runGhCommand(args, undefined);
    process.exit(exitCode);
  }

  try {
    const token = await fetchInstallationToken({ ...botConfig, args });
    const exitCode = runGhCommand(args, token);
    process.exit(exitCode);
  } catch (err) {
    console.error(`[gh-as-bot] Bot authentication error: ${err.message}`);
    process.exit(1);
  }
}

main();
