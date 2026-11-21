# idd-skills

[English](./README.md) | [日本語](./README.ja.md)

**Google Antigravity** 対応の Issue 駆動開発（Issue-Driven Development: IDD）プラグインです。

## `idd-implement` スキル概要

GitHub の Issue 番号または Pull Request 番号を起点として、以下のフローを確認待ちなしで自律的に完結させるスキルです。

- **新規 Issue 実装フロー**: 要件・不明点の確認 → 仕様・技術要件コメントの投稿（または確認コメントを投稿して `question` ラベルを付与し終了） → `question` ラベルの解除と GitHub Project `Status` の `In Progress` への更新（実装直前） → `git worktree` 上での実装とテスト・ビルド検証 → Pull Request の作成 → GitHub Project `Status` の `In Review` への更新（選択肢がある場合） → 元のブランチへの復帰
- **PR レビュー対応フロー**: PR 番号（またはオープン中の PR を持つ Issue 番号）を指定すると、PR のレビュー・通常コメント・インラインの差分レビューコメント（未解決スレッド）および紐づく Issue を確認 → 不明点があれば PR へ確認コメントを投稿して終了 → 紐づく Issue の `Status` を `In Progress` に更新 → PR の既存ブランチを `git worktree` でチェックアウトして修正・テスト検証 → コミット＆プッシュ → インラインコメントへの返信・PR サマリーコメント投稿・再レビュー依頼 → `Status` を `In Review` に更新（選択肢がある場合） → 元のブランチへの復帰

同梱のスクリプト [`scripts/gh-as-bot.mjs`](./skills/idd-implement/scripts/gh-as-bot.mjs) および [`scripts/git-as-bot.mjs`](./skills/idd-implement/scripts/git-as-bot.mjs) により、**`~/.config/github-app/.env` が存在し Bot 認証に成功した場合は専用の GitHub App（`<app-name>[bot]`）として** Issue / PR コメント・レビュー返信・ラベル操作・PR 作成に加えて **`git commit` / `git push` も Bot として実行**し、設定情報がない場合や認証・権限に通らなかった場合は **ローカルで設定・ログイン中の GitHub / Git ユーザーへフォールバック** します（`gh-as-bot.mjs` でローカルユーザーとしてコメント・レビュー返信を投稿する場合は、AI による投稿であることを明示するため、最初の見出しの後に `（🤖AIによる投稿）` が自動で記載されます；見出しがない本文では先頭に付与されます）。GitHub Projects（Projects v2）の `Status` 更新については、[`scripts/update-project-status.mjs`](./skills/idd-implement/scripts/update-project-status.mjs) が Organization リポジトリでは Bot トークンを使用し（未設定・認証失敗時はローカル認証へフォールバック）、個人（`User`）リポジトリではローカルで認証済みの `gh` CLI を使用します（GitHub App の Installation Access Token では個人所有の Projects v2 にアクセスできないため）。

---

## 動作仕様（認証の切り替えルール）

| 条件 | 使用される認証主体 | コメント本文および Git コミット・プッシュの挙動 |
| :--- | :--- | :--- |
| `~/.config/github-app/.env` が **存在し、Bot 認証に成功した** | `.env` で指定された GitHub App（`<app-name>[bot]`）の Installation Access Token | コメント・PR はそのまま投稿（GitHub 上で `[bot]` バッジが表示）；`git commit` は `<app-slug>[bot]`（`<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`）名義で作成；`git push` は Bot トークンで HTTPS 認証して実行 |
| GitHub App の情報がない、または **認証・権限に通らなかった** | 警告を出力した上でローカル環境の `gh` CLI でログイン中のユーザー（`gh auth status`）およびローカルの `git` 設定・認証情報 | コメントは最初の見出しの後に `（🤖AIによる投稿）` を自動追記；`git commit` / `git push` はローカルの `git` 著者設定・認証情報へフォールバック |

> [!NOTE]
> **ローカルユーザーへのフォールバックと AI 投稿の明示**
> `~/.config/github-app/.env` が存在しない場合に加えて、設定値の不足や `.pem` ファイルの欠落、対象リポジトリへの未インストール、API 認証エラーなどで GitHub App の認証が通らなかった場合は、警告を出力してローカルでログイン中の `gh` ユーザーへフォールバックします。その際、`gh-as-bot.mjs` は `issue comment` / `pr comment` / `pr review` およびレビュー返信 API 呼び出しの本文にある最初の見出しの直後に「`（🤖AIによる投稿）`」を自動付与します（例: `### 仕様・機能要件（🤖AIによる投稿）`）。見出しが含まれない本文の場合は先頭に付与し、すでに記載済みの場合は重複付与しません。

---

## 前提条件

- **Node.js**（v18 以上推奨。標準モジュールのみを使用するため `npm install` は不要です）
- **GitHub CLI (`gh`)**
  - GitHub App を使用しない場合は `gh auth login` で認証済みであること
  - **個人（`User`）アカウント** のリポジトリで **GitHub Projects（Projects v2）** を使用する場合は、コメントや PR 作成に GitHub App Bot を使っていても、ローカルの `gh` CLI に `project` スコープが必要です（`gh auth refresh -s project`）。
- **Git**（`git worktree` に対応していること）
- **GitHub Projects（Projects v2）** *(ステータス自動更新を行う場合に必要)*
  - 旧来の Projects (classic) は非対応です。**Projects v2** をご利用ください。
  - 対象リポジトリや Issue が公開中の Projects v2 を利用していない場合、スキルは Project ステータスの更新を自動でスキップして処理を続行します。

---

## GitHub Projects（Projects v2）およびラベルの準備

`idd-implement` 実行時にステータスを自動更新するには、リポジトリに紐づいた（または対象 Issue を登録した）公開中の **GitHub Projects（Projects v2）** を用意し、単一選択フィールド **`Status`** に以下の選択肢を設定してください。

| ステータス選択肢 | 必須度 | 更新タイミング | 選択肢が存在しない場合の挙動 |
| :--- | :---: | :--- | :--- |
| **`In Progress`** | 推奨 | 実装開始の直前（仕様コメント投稿後、`git worktree` 作成およびコード実装の前） | 警告を出力して実装を続行 |
| **`In Review`** | 任意 | Pull Request 作成の直後 | 警告を出さずにスキップ |

- その他の一般的なステータス（着手前の `Todo` / `Backlog`、PR マージで Issue がクローズされた際に GitHub 標準ワークフローで遷移する `Done` など）は通常通り自由に設定できます。
- **`question` ラベル**: 要件に不明点がある場合（Goal A）は自動で `question` ラベルを付与します（リポジトリに未作成の場合は作成を試みます）。不明点が解消され実装に進む場合（Goal B）は自動で `question` ラベルを外します。

---

## インストール方法

このリポジトリを `~/.gemini/config/plugins` 配下にクローンすることで、グローバルの **Antigravity** プラグインとして自動認識・有効化されます。

```bash
# plugins ディレクトリが存在しない場合は作成
mkdir -p ~/.gemini/config/plugins

# ディレクトリに移動してクローン
cd ~/.gemini/config/plugins
git clone https://github.com/sawarame/idd-skills.git
```

SSH 経由でクローンする場合は以下を実行してください。

```bash
cd ~/.gemini/config/plugins
git clone git@github.com:sawarame/idd-skills.git
```

---

## GitHub App（Bot）の作成手順

AI による Issue コメントや Pull Request を個人アカウントから分離し、`[bot]` バッジ付きで投稿したい場合は、以下の手順で専用の GitHub App を作成します。

1. GitHub にログインし、右上のプロフィールアイコンから **Settings** → 左サイドバー最下部の **Developer settings** → **GitHub Apps** → **New GitHub App** を開きます。
2. 基本情報を入力します：
   - **GitHub App name**: 任意の一意な名前（`<app-name>[bot]` として表示されます。例: `yourname-ai-agent`）。
   - **Homepage URL**（必須）: 有効な `https://...` URL（Web サーバーの稼働は不要で、ご自身のプロフィール `https://github.com/<username>` やリポジトリ URL で構いません）。
   - **Identifying and authorizing users（Callback URL 等）**: すべて **空欄** のままにします。
3. **Webhook** セクションの **Active のチェックを外します**（ローカル実行であり Webhook 受信サーバーを使用しないため）。
4. **Permissions** → **Repository permissions** で以下の権限を設定します：
   - **Issues**: `Read and write`（Issue の閲覧、コメント投稿、`question` 等のラベル操作に必要）
   - **Pull requests**: `Read and write`（PR の作成・更新に必要）
   - **Contents**: `Read and write`（`git-as-bot.mjs` で Bot トークンを使って `git push` を行う場合に必要。`Read-only` の場合は警告を出力した上でローカルの `git` 認証情報へフォールバックして push します）
   - **Metadata**: 自動的に `Read-only` になります。
   - *(**Organization** で GitHub Projects v2 を利用する場合)* **Permissions** → **Organization permissions** にある **Projects** も `Read and write` に設定してください（Repository permissions 側の Projects は旧 Projects (classic) 用であるため混同しないよう注意してください）。Organization へのインストールや権限変更後は、インストール設定画面で **Accept new permissions** を承認してください。
5. **Where can this GitHub App be installed?** で **Only on this account** を選択し、**Create GitHub App** をクリックします。
6. 作成された App の設定画面で、**About** セクションにある **App ID**（数値）を控えます。
7. 同ページ下部の **Private keys** セクションで **Generate a private key** をクリックし、`.pem` ファイルをダウンロードします。
8. 左サイドバーの **Install App** を開き、対象アカウントに対して **Install** をクリックして、対象リポジトリ（または **All repositories**）へインストールします。

---

## `.pem` ファイルと `.env` の配置

### 1. `.pem` ファイルを安全な場所へ移動

秘密鍵（`.pem`）を Git リポジトリやクラウド同期フォルダ（iCloud 等）には置かず、`~/.config/github-app/` 配下に権限を絞って配置します。

```bash
mkdir -p ~/.config/github-app
chmod 700 ~/.config/github-app

# ダウンロードした .pem ファイルを移動し、所有者のみ読み書き可能にする
mv ~/Downloads/<downloaded-filename>.pem ~/.config/github-app/<app-name>.pem
chmod 600 ~/.config/github-app/<app-name>.pem
```

### 2. `~/.config/github-app/.env` の作成

以下の内容で `~/.config/github-app/.env` を作成し、パーミッションを `600` に設定します。

```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=~/.config/github-app/<app-name>.pem
```

```bash
chmod 600 ~/.config/github-app/.env
```

#### 設定可能な変数一覧

| 変数名 | 必須 | 説明 |
| :--- | :---: | :--- |
| `GITHUB_APP_ID` | 必須 | GitHub App 設定画面の **App ID**（数値） |
| `GITHUB_APP_PRIVATE_KEY_PATH` | 必須 | `.pem` ファイルのパス。`~`、`$HOME`、`${HOME}`、または `.env` からの相対パスを指定可能 |
| `GITHUB_APP_INSTALLATION_ID` | 任意 | 特定の Installation ID を固定したい場合のみ指定（未指定時は対象リポジトリから自動検出） |
| `GITHUB_APP_ENV_FILE` | 任意 | 環境変数として指定した場合、デフォルトの `~/.config/github-app/.env` の代わりに使用する `.env` ファイルパス |

---

## 動作確認

GitHub App をインストール済みのリポジトリディレクトリ内で以下の読み取り専用コマンドを実行すると、設定を確認できます（Issue や PR の変更は行いません）。

### Bot 認証の確認

```bash
# アクセス可能なリポジトリ数が返れば成功
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api /installation/repositories --jq '.repositories | length'

# 特定の Issue 取得テスト
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue view <issue-number> --json number,title
```

> [!NOTE]
> Bot の Installation Access Token で `api /user` を呼び出すと `HTTP 403: Resource not accessible by integration` が返りますが、これは個人ユーザーではなく GitHub App（Installation Token）として認証されていることを示す正常な挙動です。

### `.env` が存在しない場合のフォールバック確認

```bash
# 一時的に存在しないパスを指定すると、ローカルでログイン中の gh ユーザー名が表示される
GITHUB_APP_ENV_FILE=/tmp/nonexistent-gh-bot.env \
  node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api /user --jq .login

# git-as-bot.mjs 経由の git コマンド動作確認
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/git-as-bot.mjs status --short
```

---

## セキュリティ設計と運用上の注意

- **秘密鍵とトークンを AI コンテキストに露出させない設計**
  `gh-as-bot.mjs` と `git-as-bot.mjs` は `.env` と `.pem` を内部で読み込み、取得した Installation Access Token をインメモリのみから子プロセスへ渡します（`gh` には `GH_TOKEN` 環境変数、`git` には一時 `GIT_ASKPASS` スクリプトと `IDD_GIT_BOT_TOKEN` 環境変数を使用し、CLI 引数・リモート URL・`.git/config` やディスクへのトークン保存、標準出力への表示は行いません）。[SKILL.md](./skills/idd-implement/SKILL.md) でも AI エージェントが `.env` や `.pem` を直接読み取ることを禁止しています。
- **`git commit` / `git push` 時の Bot 名義と認証**
  GitHub App が設定され認証に成功した場合、`git-as-bot.mjs` は Bot の GitHub アカウント情報（`<app-slug>[bot]` / `<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`）でコミットを作成し、Bot の Installation Access Token を使って HTTPS 経由で `git push` を実行します（ローカルの `origin` リモートが SSH の場合も、`.git/config` を書き換えずに一時的な `-c` オプションで HTTPS 認証に切り替えます）。Bot 設定がない場合・認証失敗時・`Contents: Read and write` 権限不足時は、警告を出力して通常のローカル `git` 著者設定・認証情報へフォールバックします。
  *補足: コミットや PR を Bot 名義で作成することで、AI による変更を分離し、ご自身の個人 GitHub アカウントから PR をレビュー・Approve できるようになります。*

---

## トラブルシューティング

- **`Failed to retrieve GitHub App installation information for repository owner/repo`（`HTTP 404`）**
  - 対象の GitHub リポジトリに GitHub App がインストールされていません。GitHub App 設定の **Install App** から対象リポジトリを追加してください。
- **`Resource not accessible by integration`（`HTTP 403`）または `git push` がローカル認証へフォールバックする**
  - GitHub App の **Repository permissions** で `Issues: Read and write`、`Pull requests: Read and write`、または `Contents: Read and write`（Bot での `git push` に必要）が不足している可能性があります。権限変更後は GitHub 上のインストール画面で変更の承認（**Accept new permissions**）が必要な場合があります。
- **コメント・コミット・PR が個人アカウントのまま作成される**
  - `~/.config/github-app/.env` のパスとファイル名が正確か、また実行時の標準エラー出力に `[gh-as-bot] Warning:` や `[git-as-bot] Warning:`（Bot 認証失敗によるフォールバック警告）が出ていないか確認してください。
  - エージェントが `gh-as-bot.mjs` / `git-as-bot.mjs` を経由せず `gh` や `git` を直接呼び出したり、GitHub MCP ツールを使っていないか確認してください（[SKILL.md](./skills/idd-implement/SKILL.md) では両ラッパーの優先使用を指定しています）。
- **GitHub Project の `Status` が `In Progress` や `In Review` に更新されない**
  - **個人（`User`）リポジトリの場合**: GitHub App の Installation Access Token では個人所有の Projects v2 にアクセスできないため、`update-project-status.mjs` はローカルの `gh` CLI を使用します。`project` スコープが不足している場合は `gh auth refresh -s project` を実行してください。
  - **Organization リポジトリの場合**: GitHub App に **Organization permissions → Projects: `Read and write`** が設定され、Organization 側で承認（**Accept new permissions**）されているか確認してください。
  - **非ブロッキングな挙動**: リポジトリが Projects v2 を使用していない場合、Issue が公開中の Project に未登録の場合、または `Status` に `In Progress` が存在しない場合、`update-project-status.mjs` は通知や警告を出して終了コード `0` で終了し、実装を続行します。`Status` に `In Review` が存在しない場合は、警告なしで PR 作成後の更新をスキップします。
