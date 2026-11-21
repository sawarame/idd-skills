# idd-skills

[English](./README.md) | [日本語](./README.ja.md)

An issue-driven development (IDD) plugin compatible with **Google Antigravity**.

It provides two complementary skills:
- **`idd-issue`**: Interactively brainstorms ideas with AI against your repository context and posts a structured GitHub Issue **as your locally authenticated `gh` user**.
- **`idd-implement`**: Starts from an existing GitHub Issue or Pull Request number and autonomously inspects requirements/reviews, implements and verifies changes in an isolated `git worktree`, and opens or updates Pull Requests.

## `idd-issue` Skill Documentation

An interactive skill ([`SKILL.md`](./skills/idd-issue/SKILL.md)) for turning rough ideas or tasks into well-structured GitHub Issues ready for `idd-implement`:

- **End-to-End Flow**: Initial idea or task input → read-only repository & existing Issue inspection → interactive brainstorming to resolve ambiguities → structured Issue drafting → mandatory full preview & explicit user confirmation → creating the Issue via `gh issue create` → suggesting `/idd-implement <issue-number>`.
- **Read-Only Repository Exploration**: Inspects project conventions (`CONTRIBUTING.md`, `AGENTS.md`, `README*`, etc.), `.github/ISSUE_TEMPLATE/`, relevant codebase files, existing open Issues (to avoid duplicates), and repository labels without modifying any files or branches.
- **Interactive Brainstorming**: Refines purpose, functional specifications, out-of-scope boundaries, technical considerations, and acceptance criteria through focused dialogue so downstream implementation does not stall on ambiguities.
- **Mandatory Preview & Confirmation**: Presents the complete draft (target repository, local `gh` account, title, optional labels/assignees, and Markdown body) and waits for your explicit approval before posting.
- **Posted as Your Local `gh` User**: Creates the Issue directly via `gh issue create` under your locally logged-in `gh` CLI account (never via `gh-as-bot.mjs` or the GitHub App Bot, and **without** appending `（🤖AIによる投稿）`). GitHub Projects (Projects v2) registration and status transitions are out of scope for `idd-issue`.
- **Smooth Handoff to `idd-implement`**: After creating the Issue, reports the Issue number and URL and guides you to run `/idd-implement <issue-number>` when ready to implement.

---

## `idd-implement` Skill Documentation

An autonomous, non-interactive skill that starts from a GitHub Issue number or Pull Request number and executes the full workflow end-to-end:

- **New Issue Implementation Flow**: Reviewing requirements and open questions → posting a specification/technical requirements comment (or adding the `question` label and exiting after posting a clarification comment) → removing `question` if present & updating GitHub Project `Status` to `In Progress` immediately before implementation → implementing and verifying in a `git worktree` → creating a Pull Request → updating GitHub Project `Status` to `In Review` if available → returning to the original branch.
- **PR Review Response Flow**: When invoked with a PR number (or an Issue number that already has an open PR with review feedback), inspects PR reviews, conversation comments, unresolved inline diff review threads, and linked Issues → posts clarification questions on the PR and exits if feedback is ambiguous → updates the linked Issue's Project `Status` to `In Progress` → checks out the existing PR branch in a `git worktree`, implements and verifies fixes → commits & pushes updates → replies to addressed inline review comments, posts a PR summary comment, and requests re-review → updates Project `Status` to `In Review` if available → cleans up the worktree and returns to the original branch.

Using the bundled wrapper scripts [`scripts/gh-as-bot.mjs`](./skills/idd-implement/scripts/gh-as-bot.mjs) and [`scripts/git-as-bot.mjs`](./skills/idd-implement/scripts/git-as-bot.mjs), the skill posts Issue/PR comments, inline review replies, label updates, Pull Requests, **and `git commit` / `git push` operations** **as a dedicated GitHub App (`<app-name>[bot]`) when `~/.config/github-app/.env` is configured and Bot authentication succeeds**, or falls back to **the locally authenticated GitHub / Git user** when GitHub App configuration is absent, authentication fails, or `Contents: Read and write` permission is missing for `git push` (when posting comments or review replies via `gh-as-bot.mjs` as the local user, `（🤖AIによる投稿）` is automatically appended after the first heading—or prepended when no heading is present—to clearly indicate an AI-authored comment). For GitHub Projects (Projects v2) `Status` updates, [`scripts/update-project-status.mjs`](./skills/idd-implement/scripts/update-project-status.mjs) uses the Bot token for Organization repositories (falling back to local `gh` authentication if unconfigured or Bot auth fails) and uses the locally authenticated `gh` user for personal (`User`) repositories (since GitHub App Installation Tokens cannot access user-owned Projects v2).

---

## Behavior (Authentication Switching Rules)

> [!NOTE]
> The Bot/local authentication switching below applies to **`idd-implement`**. **`idd-issue`** always invokes `gh issue create` directly as your locally authenticated `gh` CLI user (and never appends `（🤖AIによる投稿）`).

| Condition | Authentication Identity Used | Comment Body & Git Commit/Push Behavior |
| :--- | :--- | :--- |
| `~/.config/github-app/.env` **exists and Bot authentication succeeds** | Installation Access Token of the GitHub App (`<app-name>[bot]`) specified in `.env` | Comments/PRs are posted as-is (GitHub displays the `[bot]` badge); `git commit` uses `<app-slug>[bot]` author/committer (`<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`); `git push` authenticates via Bot token over HTTPS |
| GitHub App configuration is missing, or **authentication/permission fails** | Falls back with a warning to the user currently logged into the local `gh` CLI (`gh auth status`) / local `git` config & credentials | Comments automatically append `（🤖AIによる投稿）` after the first heading; `git commit` / `git push` fall back to your local `git` author configuration and credentials |

> [!NOTE]
> **Fallback to Local User and AI Post Attribution**
> If `~/.config/github-app/.env` does not exist—or if GitHub App authentication fails due to missing configuration values, a missing `.pem` file, the App not being installed on the target repository, or an API authentication error—`gh-as-bot.mjs` outputs a warning and falls back to the locally authenticated `gh` user. In that case, `gh-as-bot.mjs` automatically appends `（🤖AIによる投稿）` right after the first heading in `issue comment` / `pr comment` / `pr review` bodies and comment/reply API calls (e.g., `### Specifications & Functional Requirements（🤖AIによる投稿）`) so readers can tell the comment was posted by AI. If the body has no headings, it prepends the marker; if already present, it is not duplicated.

---

## Prerequisites

- **Node.js** (v18 or later recommended; uses built-in modules only, so `npm install` is not required)
- **GitHub CLI (`gh`)**
  - Must be authenticated via `gh auth login` if not using a GitHub App
  - If you use **GitHub Projects (Projects v2)** on a **personal (`User`)** repository, ensure your local `gh` CLI includes the `project` scope (`gh auth refresh -s project`), even when using a GitHub App Bot for comments and PRs.
- **Git** (with `git worktree` support)
- **GitHub Projects (Projects v2)** *(Required if you want automatic status transitions)*
  - Legacy Projects (classic) are not supported; use **Projects v2**.
  - If the repository/Issue does not use open Projects v2, the skill automatically skips Project status updates and continues the workflow.

---

## GitHub Projects (Projects v2) & Label Configuration

To enable automatic status tracking during `idd-implement`, set up an open **GitHub Projects (Projects v2)** board linked to your repository (or add your target Issues to an open Project v2) with a single-select **`Status`** field containing the following options:

| Status Option | Required | Timing of Update | Behavior When Missing |
| :--- | :---: | :--- | :--- |
| **`In Progress`** | Recommended | Immediately before implementation begins (after posting the spec comment, before creating the `git worktree` and editing code) | Outputs a warning and continues implementation |
| **`In Review`** | Optional | Immediately after the Pull Request is created | Skips cleanly without warning |

- Other standard statuses (such as `Todo` / `Backlog` before starting, or `Done` via GitHub's built-in workflow when the PR is merged and closes the Issue) can be configured freely as usual.
- **`question` Label**: When clarification is needed (Goal A), the skill automatically adds the `question` label to the Issue (creating it if it does not exist yet). Once clarifications are resolved and implementation starts (Goal B), the `question` label is automatically removed.

---

## Installation

### Google Antigravity (Global Plugin)

By cloning this repository into the `~/.gemini/config/plugins` directory, it is automatically recognized and enabled as a global **Antigravity** plugin.

```bash
# Create the plugins directory if it does not exist
mkdir -p ~/.gemini/config/plugins

# Navigate to the directory and clone the repository
cd ~/.gemini/config/plugins
git clone https://github.com/sawarame/idd-skills.git
```

If you prefer to clone via SSH, run the following commands:

```bash
cd ~/.gemini/config/plugins
git clone git@github.com:sawarame/idd-skills.git
```

### Other AI Agents / Project-Local Setup (`git subtree`)

Dedicated `idd-issue` and `idd-implement` branches (split from `skills/idd-issue` and `skills/idd-implement` via `git subtree split`) are available so that AI coding agents other than Google Antigravity can also use either or both skills directly from a target repository's `.agents/skills` directory.

Run the following command(s) at the root of your target repository (requires a clean working tree):

```bash
# idd-issue: Interactive brainstorming & GitHub Issue creation
git subtree add \
  --prefix=.agents/skills/idd-issue \
  https://github.com/sawarame/idd-skills.git \
  idd-issue \
  --squash

# idd-implement: Autonomous Issue implementation & PR review response
git subtree add \
  --prefix=.agents/skills/idd-implement \
  https://github.com/sawarame/idd-skills.git \
  idd-implement \
  --squash
```

If you prefer SSH, replace the repository URL with `git@github.com:sawarame/idd-skills.git`.

> [!NOTE]
> - **Adjusting `--prefix` for your AI agent**: Many agents read project-local skills from `.agents/skills/`, while some tools use `.agent/skills/` or `.claude/skills/`. Adjust `--prefix` (for example, `--prefix=.agent/skills/idd-issue` or `--prefix=.agent/skills/idd-implement`) to match your AI agent's skill directory.
> - **Script paths (`idd-implement`)**: `idd-implement`'s bundled helper scripts are located under the installed skill's `scripts/` directory (e.g., `.agents/skills/idd-implement/scripts/`). When running the commands in [Verification](#verification) manually, replace `~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/...` with your installed path. (`idd-issue` uses your local `gh` CLI directly and has no bundled scripts.)
> - **GitHub App configuration**: `~/.config/github-app/.env` is stored in your home directory, so `idd-implement` Bot authentication works the same way across repositories. (Without it, `idd-implement` falls back to your local `gh` / `git` credentials.)

To pull future updates for either skill into your repository:

```bash
# Update idd-issue
git subtree pull \
  --prefix=.agents/skills/idd-issue \
  https://github.com/sawarame/idd-skills.git \
  idd-issue \
  --squash

# Update idd-implement
git subtree pull \
  --prefix=.agents/skills/idd-implement \
  https://github.com/sawarame/idd-skills.git \
  idd-implement \
  --squash
```

---

## Creating a GitHub App (Bot)

If you want AI-generated Issue comments and Pull Requests to be separated from your personal account and posted with a `[bot]` badge, create a dedicated GitHub App by following these steps:

1. Log in to GitHub, click your profile icon in the top-right corner, and navigate to **Settings** → **Developer settings** (at the bottom of the left sidebar) → **GitHub Apps** → **New GitHub App**.
2. Fill in the basic information:
   - **GitHub App name**: Enter any unique name (this name will be displayed as `<app-name>[bot]`, e.g., `yourname-ai-agent`).
   - **Homepage URL** (required): Enter a valid `https://...` URL (no running web server is required; your GitHub profile `https://github.com/<username>` or a repository URL is sufficient).
   - **Identifying and authorizing users (Callback URL, etc.)**: Leave all fields **blank**.
3. Under the **Webhook** section, **uncheck Active** (since the script runs locally and does not use a webhook receiver server).
4. Under **Permissions** → **Repository permissions**, configure the following permissions:
   - **Issues**: `Read and write` (required to view Issues, post comments, and manage labels such as `question`)
   - **Pull requests**: `Read and write` (required to create and update PRs)
   - **Contents**: `Read and write` (required so `git-as-bot.mjs` can perform `git push` using the Bot token; if set to `Read-only`, `git-as-bot.mjs` logs a warning and falls back to your local `git` credentials for `git push`)
   - **Metadata**: Automatically set to `Read-only`.
   - *(If using an **Organization** with GitHub Projects v2)* Under **Permissions** → **Organization permissions**, also set **Projects** to `Read and write` (do not confuse this with Repository-level Projects, which applies only to Projects classic). After installing or updating permissions on the Organization, approve them via **Accept new permissions**.
5. Under **Where can this GitHub App be installed?**, select **Only on this account**, then click **Create GitHub App**.
6. On the created app's settings page, note the **App ID** (numeric) shown in the **About** section.
7. Scroll down to the **Private keys** section on the same page, click **Generate a private key**, and download the `.pem` file.
8. Open **Install App** in the left sidebar, click **Install** for your account, and install it on the target repositories (or **All repositories**).

---

## Setting Up the `.pem` File and `.env`

### 1. Move the `.pem` File to a Secure Location

Do not store the private key (`.pem`) inside a Git repository or a cloud-synced folder (such as iCloud). Place it under `~/.config/github-app/` with restricted permissions.

```bash
mkdir -p ~/.config/github-app
chmod 700 ~/.config/github-app

# Move the downloaded .pem file and restrict read/write access to the owner only
mv ~/Downloads/<downloaded-filename>.pem ~/.config/github-app/<app-name>.pem
chmod 600 ~/.config/github-app/<app-name>.pem
```

### 2. Create `~/.config/github-app/.env`

Create `~/.config/github-app/.env` with the following contents and also set its permissions to `600`.

```dotenv
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=~/.config/github-app/<app-name>.pem
```

```bash
chmod 600 ~/.config/github-app/.env
```

#### Configurable Variables

| Variable Name | Required | Description |
| :--- | :---: | :--- |
| `GITHUB_APP_ID` | Required | The **App ID** (numeric) from your GitHub App settings page |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Required | Path to the `.pem` file. Supports `~`, `$HOME`, `${HOME}`, or a path relative to `.env` |
| `GITHUB_APP_INSTALLATION_ID` | Optional | Specify only if you want to pin a specific Installation ID (auto-detected from the target repository when omitted) |
| `GITHUB_APP_ENV_FILE` | Optional | When set as an environment variable, specifies an alternative `.env` file path instead of the default `~/.config/github-app/.env` |

---

## Verification

You can verify the setup by running the following read-only commands inside a repository directory where the GitHub App is installed (these commands do not modify Issues or PRs).

### Verify Bot Authentication

```bash
# Succeeds if a number representing accessible repositories is returned
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api /installation/repositories --jq '.repositories | length'

# Test fetching a specific Issue
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue view <issue-number> --json number,title
```

> [!NOTE]
> Calling `api /user` with a Bot's Installation Access Token returns `HTTP 403: Resource not accessible by integration`. This is expected behavior confirming authentication as a GitHub App (Installation Token) rather than a personal user.

### Verify Fallback When `.env` Is Absent

```bash
# Temporarily pointing to a non-existent path displays the locally logged-in gh username
GITHUB_APP_ENV_FILE=/tmp/nonexistent-gh-bot.env \
  node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api /user --jq .login

# Verify git-as-bot.mjs passes through local git commands cleanly
node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/git-as-bot.mjs status --short
```

---

## Security Design and Operational Notes

- **Keeping Private Keys and Tokens Out of AI Context**
  `gh-as-bot.mjs` and `git-as-bot.mjs` read `.env` and `.pem` internally and pass the acquired Installation Access Token strictly in memory—via the `GH_TOKEN` environment variable for `gh` and an in-memory `IDD_GIT_BOT_TOKEN` environment variable paired with a temporary `GIT_ASKPASS` script (without embedding tokens into CLI arguments, remote URLs, or `.git/config`) for `git`. They never cache tokens to disk or print keys/tokens to stdout. [SKILL.md](./skills/idd-implement/SKILL.md) also prohibits AI agents from directly reading `.env` or `.pem` files.
- **Bot Identity and Authentication During `git commit` / `git push`**
  When GitHub App configuration is present and valid, `git-as-bot.mjs` commits using the Bot's GitHub identity (`<app-slug>[bot]` / `<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`) and pushes over HTTPS using the Bot's Installation Access Token (even if your local `origin` remote uses SSH, via temporary `-c` config overrides that leave `.git/config` untouched). If Bot configuration is missing, Bot authentication fails, or `git push` fails due to missing `Contents: Read and write` permission, `git-as-bot.mjs` logs a warning and falls back to your local `git` author settings and credentials.
  *Note: Having the Bot create commits and the PR also lets you cleanly separate AI commits and review/approve the PR using your personal GitHub account.*

---

## Troubleshooting

- **`Failed to retrieve GitHub App installation information for repository owner/repo` (`HTTP 404`)**
  - The GitHub App is not installed on the target repository. Add the repository from **Install App** in your GitHub App settings.
- **`Resource not accessible by integration` (`HTTP 403`) or `git push` falling back to local credentials**
  - The GitHub App may be missing `Issues: Read and write`, `Pull requests: Read and write`, or `Contents: Read and write` (needed for Bot `git push`) under **Repository permissions**. After updating permissions, you may need to approve the updated permissions on the installation page in GitHub (**Accept new permissions**).
- **Comments, commits, or PRs are still created under your personal account**
  - Check that `~/.config/github-app/.env` has the exact path and filename, and check stderr for `[gh-as-bot] Warning:` or `[git-as-bot] Warning:` messages indicating Bot authentication fell back to the local user.
  - Check whether the agent called `gh` or `git` directly, or used GitHub MCP tools instead of `gh-as-bot.mjs` / `git-as-bot.mjs` ([SKILL.md](./skills/idd-implement/SKILL.md) specifies prioritizing both wrappers).
- **GitHub Project `Status` is not updated to `In Progress` or `In Review`**
  - **Personal (`User`) repository**: GitHub App Installation Tokens cannot access user-owned Projects v2, so `update-project-status.mjs` uses your local `gh` CLI. Run `gh auth refresh -s project` if the `project` scope is missing.
  - **Organization repository**: Ensure the GitHub App has **Organization permissions → Projects: `Read and write`** enabled and approved (**Accept new permissions**) on the Organization installation.
  - **Non-blocking behavior**: If the repository does not use Projects v2, the Issue is not registered in an open Project, or `In Progress` is missing from `Status`, `update-project-status.mjs` outputs a notice/warning and exits `0` so implementation continues. If `In Review` does not exist in `Status`, the post-PR update is skipped cleanly without warning.
