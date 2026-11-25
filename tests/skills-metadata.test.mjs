import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * マークダウンファイルの先頭にある YAML フロントマターから基本フィールドを抽出するヘルパー関数
 * @param markdown - 対象 Markdown ファイルの全文文字列
 * @returns 抽出した `name` と `description` を含むオブジェクト
 */
function parseSkillFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, 'SKILL.md に YAML フロントマターが存在すること');

  const lines = match[1].split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

test('plugin.json: 有効な JSON であり idd-issue と idd-implement の案内を含むこと', () => {
  const pluginPath = path.join(REPO_ROOT, 'plugin.json');
  const pluginJson = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

  assert.equal(pluginJson.name, 'idd-skills');
  assert.equal(pluginJson.enabled, true);
  assert.match(pluginJson.description, /idd-issue/);
  assert.match(pluginJson.description, /idd-implement/);
  assert.ok(Array.isArray(pluginJson.suggestedPrompts));
  assert.ok(
    pluginJson.suggestedPrompts.some(prompt => prompt.includes('idd-issue')),
    'suggestedPrompts に idd-issue のプロンプト例が含まれること'
  );
  assert.ok(
    pluginJson.suggestedPrompts.some(prompt => prompt.includes('idd-implement')),
    'suggestedPrompts に idd-implement のプロンプト例が含まれること'
  );
});

test('skills/idd-issue/SKILL.md: フロントマターと Issue #3 の必須要件を満たしていること', () => {
  const skillPath = path.join(REPO_ROOT, 'skills', 'idd-issue', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'skills/idd-issue/SKILL.md が存在すること');

  const content = fs.readFileSync(skillPath, 'utf8');
  const frontmatter = parseSkillFrontmatter(content);

  assert.equal(frontmatter.name, 'idd-issue');
  assert.ok(frontmatter.description && frontmatter.description.length > 20);

  // ローカル gh ユーザーで投稿し、Bot ラッパーや AI 投稿マーカーを使わない方針が明記されていること
  assert.match(content, /gh issue create/);
  assert.match(content, /gh auth status/);
  assert.match(content, /Never[\s\S]*gh-as-bot\.mjs|never[\s\S]*gh-as-bot\.mjs/i);
  assert.match(content, /\(🤖 Posted by AI\)/);
  assert.match(content, /（🤖AIによる投稿）/);

  // 投稿前プレビュー・テンプレート・idd-implement 連携が定義されていること
  assert.match(content, /\.github\/ISSUE_TEMPLATE/);
  assert.match(content, /Out of Scope/i);
  assert.match(content, /Acceptance Criteria/i);
  assert.match(content, /idd-implement/);
});

test('skills/idd-implement/SKILL.md: 既存スキルのフロントマターと言語別 AI 投稿マーカーの記載が維持されていること', () => {
  const skillPath = path.join(REPO_ROOT, 'skills', 'idd-implement', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  const frontmatter = parseSkillFrontmatter(content);

  assert.equal(frontmatter.name, 'idd-implement');
  assert.ok(frontmatter.description && frontmatter.description.length > 20);
  assert.match(content, /\(🤖 Posted by AI\)/);
  assert.match(content, /（🤖AIによる投稿）/);
});

test('README.md / README.ja.md: idd-issue と idd-implement の両スキルおよび各言語の AI 投稿マーカーが記載されていること', () => {
  const readmeEn = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const readmeJa = fs.readFileSync(path.join(REPO_ROOT, 'README.ja.md'), 'utf8');

  assert.match(readmeEn, /## `idd-issue` Skill Documentation/);
  assert.match(readmeEn, /gh issue create/);
  assert.match(readmeEn, /\(🤖 Posted by AI\)/);
  assert.match(readmeEn, /\.\/skills\/idd-issue\/README\.md/);
  assert.match(readmeEn, /\.\/skills\/idd-implement\/README\.md/);

  assert.match(readmeJa, /## `idd-issue` スキル概要/);
  assert.match(readmeJa, /gh issue create/);
  assert.match(readmeJa, /（🤖AIによる投稿）/);
  assert.match(readmeJa, /\.\/skills\/idd-issue\/README\.ja\.md/);
  assert.match(readmeJa, /\.\/skills\/idd-implement\/README\.ja\.md/);
});

test('各スキル配下の README.md / README.ja.md: 言語切替リンク・プロンプト例・SKILL.md への参照が含まれること', () => {
  const skillDocs = [
    {
      skillName: 'idd-issue',
      command: '/idd-issue',
      enPath: path.join(REPO_ROOT, 'skills', 'idd-issue', 'README.md'),
      jaPath: path.join(REPO_ROOT, 'skills', 'idd-issue', 'README.ja.md')
    },
    {
      skillName: 'idd-implement',
      command: '/idd-implement',
      enPath: path.join(REPO_ROOT, 'skills', 'idd-implement', 'README.md'),
      jaPath: path.join(REPO_ROOT, 'skills', 'idd-implement', 'README.ja.md')
    }
  ];

  for (const doc of skillDocs) {
    assert.ok(fs.existsSync(doc.enPath), `${doc.skillName}/README.md が存在すること`);
    assert.ok(fs.existsSync(doc.jaPath), `${doc.skillName}/README.ja.md が存在すること`);

    const enContent = fs.readFileSync(doc.enPath, 'utf8');
    const jaContent = fs.readFileSync(doc.jaPath, 'utf8');

    for (const content of [enContent, jaContent]) {
      assert.match(content, /\[English\]\(\.\/README\.md\) \| \[日本語\]\(\.\/README\.ja\.md\)/);
      assert.match(content, new RegExp(doc.command));
      assert.match(content, /\.\/SKILL\.md/);
      // git subtree 単体導入時のリンク切れを防ぐため、ルート README への相対参照を含めないこと
      assert.doesNotMatch(content, /\.\.\/\.\.\/README/);
    }

    assert.match(enContent, /## Usage & Prompt Examples/);
    assert.match(jaContent, /## 使い方・プロンプト例/);
  }
});
