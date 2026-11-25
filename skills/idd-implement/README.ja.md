# idd-implement

[English](./README.md) | [日本語](./README.ja.md)

既存の GitHub Issue 番号または Pull Request 番号を起点に、要件・レビュー指摘の確認から、`git worktree` 上での実装・テスト／ビルド検証、PR 作成またはレビュー対応、元のブランチへの復帰までを確認待ちなしで自律的に完結させるスキル（[`SKILL.md`](./SKILL.md)）です。

---

## 使い方・プロンプト例

AI コーディングエージェント上で `/idd-implement` と入力するか、自然文で `idd-implement` の利用を指示してください。

### 1. 新規 Issue を実装して PR を作成する

```text
/idd-implement #123
```

```text
idd-implement を使って GitHub Issue #123 を実装し、PR を作成してください
```

### 2. GitHub の Issue URL・PR URL をそのまま渡して実行する

```text
/idd-implement https://github.com/owner/repo/issues/123
```

```text
/idd-implement https://github.com/owner/repo/pull/45
```

### 3. オープン中の PR に対するレビュー指摘へ対応する

```text
/idd-implement PR #45
```

```text
idd-implement を使って PR #45 のレビューコメントに対応してください
```

*（すでにオープン中の PR が紐づいている Issue 番号を指定した場合も、未対応のレビュー指摘があれば自動で PR レビュー対応モードへ切り替わります。）*

### 4. `question` ラベルが付いた Issue に回答したあと実装を再開する

初回実行時に不明点があり確認コメント投稿＋`question` ラベル付与で終了（Goal A）した場合は、GitHub の Issue 上で回答コメントを追記したあと、同じコマンドを再実行します：

```text
/idd-implement #123
```

*（回答内容を自動で読み込み、`question` ラベルを外して実装へ進みます。）*

---

## 実行モード（3 つのゴール）

- **Goal A（不明点・要決定事項がある場合）**: 推測で実装を進めず、確認事項を整理して対象 Issue / PR にコメントを投稿し（Issue の場合は `question` ラベルを付与）、結果を報告して終了します。
- **Goal B（新規 Issue の実装）**: 仕様・技術要件コメントの投稿 → `question` ラベルの解除（付与時） → GitHub Project `Status` の `In Progress` 更新 → 一時 `git worktree` での実装・テスト／ビルド検証 → コミット・プッシュ・PR 作成 → Project `Status` の `In Review` 更新（選択肢がある場合） → worktree 削除＆元ブランチへの復帰を行います。
- **Goal C（PR レビュー対応）**: PR レビュー・会話コメント・未解決のインライン差分コメントおよび紐づく Issue を確認 → Project `Status` を `In Progress` に更新 → 既存 PR ブランチを `git worktree` でチェックアウトして修正・検証 → コミット＆プッシュ → インラインコメントへの返信・PR サマリーコメント投稿・再レビュー依頼 → `Status` を `In Review` に更新 → worktree 削除＆元ブランチへの復帰を行います。

---

## 前提条件・動作ポイント・同梱スクリプト

- **前提条件**:
  - **Node.js**（v18 以上推奨。標準モジュールのみを使用するため `npm install` 不要）
  - **GitHub CLI (`gh`)**（GitHub App を使わない場合は `gh auth login` 済み、個人リポジトリで Projects v2 を使う場合は `project` スコープが必要）
  - **Git**（`git worktree` 対応）
- **完全自律実行（確認待ちなし）**: 途中でチャット上の確認を求めず最後まで処理を進めます（判断できない仕様がある場合のみ GitHub 上にコメントして終了します）。
- **`git worktree` による作業分離**: 実装・検証・コミットは一時 worktree 内で完結するため、現在の作業ブランチや未コミットの変更に影響しません。
- **Bot 認証とローカルフォールバック**:
  - `~/.config/github-app/.env` が有効な場合は、GitHub App（`<app-name>[bot]`）としてコメント・PR 作成および `git commit` / `git push` を実行します。
  - 未設定や認証・権限エラー時は警告を出してローカルの `gh` / `git` ユーザーへフォールバックし、コメントには本文の言語に応じた AI 投稿マーカー（日本語は `（🤖AIによる投稿）`、英語は `(🤖 Posted by AI)`）を自動付与します。
- **同梱スクリプト（`scripts/`）**:
  - [`scripts/gh-as-bot.mjs`](./scripts/gh-as-bot.mjs): GitHub App Bot 認証・ローカルフォールバック・言語別 AI 投稿マーカー付与を行う `gh` ラッパー
  - [`scripts/git-as-bot.mjs`](./scripts/git-as-bot.mjs): Bot 名義での `git commit` と Bot トークンによる HTTPS `git push`（失敗時ローカルフォールバック）を行う `git` ラッパー
  - [`scripts/update-project-status.mjs`](./scripts/update-project-status.mjs): GitHub Projects（Projects v2）の `Status` を非ブロッキングで更新するスクリプト

---

## セットアップ・詳細ドキュメント

GitHub App（Bot）の作成手順、`~/.config/github-app/.env` と `.pem` の配置方法、Projects v2 の設定、動作確認コマンド、トラブルシューティングについては本体リポジトリの README を参照してください。

- [本体 README（日本語）](https://github.com/sawarame/idd-skills/blob/main/README.ja.md)
- [スキル定義（`SKILL.md`）](./SKILL.md)
