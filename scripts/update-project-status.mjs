#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  buildGhEnv,
  fetchInstallationToken,
  loadBotConfig,
  resolveTargetRepository
} from './gh-as-bot.mjs';

const DEFAULT_TARGET_STATUS = 'In Progress';

const OWNER_TYPE_QUERY = `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    owner {
      __typename
    }
  }
}
`;

const PROJECT_CONTEXT_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    projectsV2(first: 20) {
      nodes {
        id
        number
        title
        closed
      }
    }
    issue(number: $number) {
      id
      projectItems(first: 20) {
        nodes {
          id
          project {
            id
            number
            title
            closed
            fields(first: 50) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                field {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const UPDATE_STATUS_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }
  ) {
    projectV2Item {
      id
    }
  }
}
`;

/**
 * CLI 引数を解析し、Issue 番号・対象ステータス候補・任意更新フラグを抽出する関数
 * @param argv - コマンドライン引数の配列
 * @returns 解析結果オブジェクト（issueNumber, targetStatuses, optional）
 */
function parseCliArgs(argv) {
  let issueNumber = null;
  const targetStatuses = [];
  let optional = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--status' && argv[i + 1]) {
      const value = argv[i + 1].trim();
      if (value) targetStatuses.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--status=')) {
      const value = arg.slice(9).trim();
      if (value) targetStatuses.push(value);
      continue;
    }
    if (arg === '--optional') {
      optional = true;
      continue;
    }
    if ((arg === '-R' || arg === '--repo') && argv[i + 1]) {
      i += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      continue;
    }
    if (!arg.startsWith('-') && issueNumber === null) {
      const normalized = arg.replace(/^#/, '').trim();
      if (/^\d+$/.test(normalized)) {
        const parsed = Number.parseInt(normalized, 10);
        if (parsed > 0) {
          issueNumber = parsed;
        }
      }
    }
  }

  return {
    issueNumber,
    targetStatuses: targetStatuses.length > 0 ? targetStatuses : [DEFAULT_TARGET_STATUS],
    optional
  };
}

/**
 * `gh api graphql` を実行してパース済みの JSON レスポンスを返す関数
 * @param query - 実行する GraphQL クエリまたはミューテーション文字列
 * @param variables - GraphQL 変数マップ
 * @param botToken - Bot 認証トークン（ローカルユーザー実行時は undefined）
 * @returns GraphQL レスポンスの data オブジェクト
 */
function runGhGraphql(query, variables, botToken) {
  const ghArgs = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number') {
      ghArgs.push('-F', `${key}=${value}`);
    } else if (value !== undefined && value !== null) {
      ghArgs.push('-f', `${key}=${String(value)}`);
    }
  }

  const result = spawnSync('gh', ghArgs, {
    encoding: 'utf8',
    env: buildGhEnv(botToken)
  });

  if (result.error) {
    throw new Error(`Failed to execute gh CLI: ${result.error.message}`);
  }

  let parsed = null;
  if (result.stdout) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // JSON パース失敗時は後続のエラーハンドリングへ委ねる
    }
  }

  if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
    const errorDetails = parsed.errors
      .map(err => `${err.type ? `[${err.type}] ` : ''}${err.message || 'Unknown GraphQL error'}`)
      .join('; ');
    throw new Error(errorDetails);
  }

  if (result.status !== 0) {
    const stderrText = (result.stderr || '').trim();
    const stdoutText = (result.stdout || '').trim();
    throw new Error(stderrText || stdoutText || `gh exited with status ${result.status}`);
  }

  return parsed?.data ?? null;
}

/**
 * 権限不足や認証エラーの内容に応じてわかりやすい警告メッセージを生成する関数
 * @param errMessage - 発生したエラーメッセージ
 * @param ownerType - リポジトリ所有者の種別（User または Organization）
 * @param usedBotToken - Bot トークンで実行したかどうか
 * @returns ユーザー・エージェント向けの警告メッセージ
 */
function formatPermissionWarning(errMessage, ownerType, usedBotToken) {
  if (
    usedBotToken &&
    ownerType === 'Organization' &&
    /Resource not accessible by integration|FORBIDDEN|INSUFFICIENT_SCOPES/i.test(errMessage)
  ) {
    return (
      '[update-project-status] Warning: GitHub App lacks Organization "Projects: Read and write" ' +
      'permission (or pending permission approval). Continuing implementation without updating Project status. ' +
      `Details: ${errMessage}`
    );
  }

  if (
    !usedBotToken &&
    /project|INSUFFICIENT_SCOPES|not logged into|auth login|401/i.test(errMessage)
  ) {
    return (
      '[update-project-status] Warning: Local gh CLI is missing the "project" scope or authentication ' +
      '(run "gh auth refresh -s project"). Continuing implementation without updating Project status. ' +
      `Details: ${errMessage}`
    );
  }

  return `[update-project-status] Warning: Failed to update GitHub Project status. Continuing implementation. Details: ${errMessage}`;
}

/**
 * 文字列を前後の空白除去および小文字化して比較用に正規化する関数
 * @param value - 正規化対象の文字列
 * @returns 正規化済み文字列
 */
function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * 単一の Project アイテムの Status フィールドを指定候補のいずれかへ更新する関数
 * @param item - GraphQL で取得した ProjectV2Item オブジェクト
 * @param issueNumber - 対象の Issue 番号
 * @param targetStatuses - 設定したいステータス名候補の配列（先頭から優先して一致検索）
 * @param authToken - 使用する認証トークン（ローカル実行時は undefined）
 * @param optional - 候補ステータスが Project に存在しない場合に警告を出さずスキップするか
 * @returns 処理結果（警告時も呼び出し元で続行するため例外は内部で処理）
 */
function updateSingleProjectItem(item, issueNumber, targetStatuses, authToken, optional) {
  const project = item.project;
  const fields = project.fields?.nodes ?? [];
  const statusField = fields.find(
    field =>
      field &&
      normalizeLabel(field.name) === 'status' &&
      Array.isArray(field.options)
  );

  if (!statusField) {
    console.warn(
      `[update-project-status] Warning: Project "${project.title}" (#${project.number}) does not have a single-select "Status" field. Continuing.`
    );
    return;
  }

  // 指定された候補ステータスを先頭から順に検索し、最初に一致した選択肢を採用する
  let targetOption = null;
  for (const candidate of targetStatuses) {
    targetOption = statusField.options.find(
      option => option && normalizeLabel(option.name) === normalizeLabel(candidate)
    );
    if (targetOption) break;
  }

  if (!targetOption) {
    const expectedLabel = targetStatuses.join('" / "');
    if (optional) {
      console.log(
        `[update-project-status] Info: Project "${project.title}" (#${project.number}) does not have a "${expectedLabel}" option in "Status"; skipping.`
      );
      return;
    }
    const availableOptions = statusField.options.map(option => option.name).join(', ');
    console.warn(
      `[update-project-status] Warning: Project "${project.title}" (#${project.number}) does not have a "${expectedLabel}" option in "Status" (available: ${availableOptions}). Continuing.`
    );
    return;
  }

  const currentFieldValue = (item.fieldValues?.nodes ?? []).find(
    value => value?.field?.id === statusField.id
  );
  if (currentFieldValue?.optionId === targetOption.id) {
    console.log(
      `[update-project-status] Info: Project "${project.title}" (#${project.number}) Status for Issue #${issueNumber} is already "${targetOption.name}".`
    );
    return;
  }

  runGhGraphql(
    UPDATE_STATUS_MUTATION,
    {
      projectId: project.id,
      itemId: item.id,
      fieldId: statusField.id,
      optionId: targetOption.id
    },
    authToken
  );

  console.log(
    `[update-project-status] Updated Project "${project.title}" (#${project.number}) Status for Issue #${issueNumber} to "${targetOption.name}".`
  );
}

/**
 * スクリプトのエントリポイント。リポジトリと Issue の GitHub Projects v2 利用状況を確認し、Status を更新する関数
 * @returns 処理完了時に解決する Promise
 */
async function main() {
  const args = process.argv.slice(2);
  const { issueNumber, targetStatuses, optional } = parseCliArgs(args);

  if (!issueNumber || targetStatuses.length === 0) {
    console.error(
      'Usage: node update-project-status.mjs <issue-number> [--status "In Progress"] [--optional] [-R owner/repo]'
    );
    process.exit(1);
  }

  const targetRepo = resolveTargetRepository(args);
  if (!targetRepo) {
    console.warn(
      '[update-project-status] Warning: Could not identify target repository (owner/repo). Continuing without updating Project status.'
    );
    process.exit(0);
  }

  let botToken = undefined;
  let botConfig = null;
  try {
    botConfig = loadBotConfig();
    if (botConfig) {
      botToken = await fetchInstallationToken({ ...botConfig, args });
    }
  } catch (err) {
    // GitHub App の情報不足や認証失敗時はローカルの gh 認証へフォールバックする
    console.warn(
      `[update-project-status] Warning: Could not acquire Bot token (${err.message}). Falling back to local gh authentication.`
    );
    botToken = undefined;
  }

  let ownerType = 'User';
  try {
    const ownerData = runGhGraphql(
      OWNER_TYPE_QUERY,
      { owner: targetRepo.owner, repo: targetRepo.repo },
      botToken
    );
    ownerType = ownerData?.repository?.owner?.__typename || 'User';
  } catch (err) {
    console.warn(
      `[update-project-status] Warning: Failed to inspect repository owner type (${err.message}). Continuing without updating Project status.`
    );
    process.exit(0);
  }

  // 個人アカウント所有の Projects v2 は GitHub App Installation Token から参照・更新できないため、ローカル gh 認証を使用する
  const projectAuthToken = ownerType === 'Organization' ? botToken : undefined;
  const usedBotToken = Boolean(projectAuthToken);

  if (ownerType === 'User' && botToken) {
    console.log(
      '[update-project-status] Info: Personal repository detected; using local gh authentication for Projects v2.'
    );
  }

  let projectData = null;
  try {
    projectData = runGhGraphql(
      PROJECT_CONTEXT_QUERY,
      {
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        number: issueNumber
      },
      projectAuthToken
    );
  } catch (err) {
    console.warn(formatPermissionWarning(err.message, ownerType, usedBotToken));
    process.exit(0);
  }

  const repository = projectData?.repository;
  if (!repository?.issue) {
    console.warn(
      `[update-project-status] Warning: Issue #${issueNumber} was not found in ${targetRepo.owner}/${targetRepo.repo}. Continuing.`
    );
    process.exit(0);
  }

  const openRepoProjects = (repository.projectsV2?.nodes ?? []).filter(
    project => project && !project.closed
  );
  const openIssueItems = (repository.issue.projectItems?.nodes ?? []).filter(
    item => item?.project && !item.project.closed
  );

  // リポジトリにも Issue にも公開中の Projects v2 が紐付いていなければ未使用と判断してスキップする
  if (openRepoProjects.length === 0 && openIssueItems.length === 0) {
    console.log(
      `[update-project-status] Info: ${targetRepo.owner}/${targetRepo.repo} does not appear to use open GitHub Projects (Projects v2). Skipping status update.`
    );
    process.exit(0);
  }

  if (openIssueItems.length === 0) {
    console.warn(
      `[update-project-status] Warning: Issue #${issueNumber} is not registered in any open GitHub Project. Continuing implementation.`
    );
    process.exit(0);
  }

  for (const item of openIssueItems) {
    try {
      updateSingleProjectItem(item, issueNumber, targetStatuses, projectAuthToken, optional);
    } catch (err) {
      console.warn(formatPermissionWarning(err.message, ownerType, usedBotToken));
    }
  }
}

main();
