# idd-skills

An issue-driven development (IDD) plugin compatible with **Google Antigravity**.

## `idd-implement` Skill Documentation

An autonomous, non-interactive skill that starts from a GitHub Issue number and executes the full workflow end-to-end: **reviewing requirements and open questions → posting a specification/technical requirements comment (or adding the `question` label and exiting after posting a clarification comment) → removing `question` if present & updating GitHub Project `Status` to `In Progress` immediately before implementation → implementing and verifying in a `git worktree` → creating a Pull Request → updating GitHub Project `Status` to `In Review` if available → returning to the original branch**.

Using the bundled wrapper script [`scripts/gh-as-bot.mjs`](./skills/idd-implement/scripts/gh-as-bot.mjs), the skill posts Issue comments, updates labels, and creates Pull Requests **as a dedicated GitHub App (`<app-name>[bot]`) when `~/.config/github-app/.env` is present**, or **as the locally authenticated GitHub user** when it is not configured. For GitHub Projects (Projects v2) `Status` updates, [`scripts/update-project-status.mjs`](./skills/idd-implement/scripts/update-project-status.mjs) uses the Bot token for Organization repositories and falls back to the locally authenticated `gh` user for personal (`User`) repositories (since GitHub App Installation Tokens cannot access user-owned Projects v2).

---

## Behavior (Authentication Switching Rules)

| Condition | Authentication Identity Used |
| :--- | :--- |
| `~/.config/github-app/.env` **exists** | Installation Access Token of the GitHub App (`<app-name>[bot]`) specified in `.env` |
| `~/.config/github-app/.env` **does not exist** | The user currently logged into the local `gh` CLI (`gh auth status`) |

> [!IMPORTANT]
> **Preventing Unintended Posts from a Personal Account**
> If `~/.config/github-app/.env` exists and there are missing configuration values, a missing `.pem` file, or an API authentication error, `gh-as-bot.mjs` will fail with an error rather than silently falling back to your personal account.

---

## Prerequisites

- **Node.js** (v18 or later recommended; uses built-in modules only, so `npm install` is not required)
- **GitHub CLI (`gh`)**
  - Must be authenticated via `gh auth login` if not using a GitHub App
  - If you use **GitHub Projects (Projects v2)** on a **personal (`User`)** repository, ensure your local `gh` CLI includes the `project` scope (`gh auth refresh -s project`), even when using a GitHub App Bot for comments and PRs.
- **Git** (with `git worktree` support)

---

## Installation

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
   - **Contents**: `Read and write` (required if `git push` is performed with a Bot token in the future; `Read-only` is sufficient if pushing with standard local `git` credentials)
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
```

---

## Security Design and Operational Notes

- **Keeping Private Keys and Tokens Out of AI Context**
  `gh-as-bot.mjs` reads `.env` and `.pem` internally and passes the acquired Installation Access Token to the `gh` child process strictly in memory via the `GH_TOKEN` environment variable (it never caches tokens to disk or prints keys/tokens to stdout). [SKILL.md](./skills/idd-implement/SKILL.md) also prohibits AI agents from directly reading `.env` or `.pem` files.
- **Authentication During `git push`**
  Bot authentication applies to GitHub API operations performed via the `gh` CLI (viewing Issues, posting comments, creating PRs). `git push` runs using your normal local Git credentials (SSH / HTTPS).
  *Note: Having the Bot create the PR also lets you review and approve the PR using your personal GitHub account.*

---

## Troubleshooting

- **`Failed to retrieve GitHub App installation information for repository owner/repo` (`HTTP 404`)**
  - The GitHub App is not installed on the target repository. Add the repository from **Install App** in your GitHub App settings.
- **`Resource not accessible by integration` (`HTTP 403`)**
  - The GitHub App may be missing `Issues: Read and write` or `Pull requests: Read and write` under **Repository permissions**. After updating permissions, you may need to approve the updated permissions on the installation page in GitHub (**Accept new permissions**).
- **Comments or PRs are still posted under your personal account**
  - Check that `~/.config/github-app/.env` has the exact path and filename.
  - Check whether the agent called `gh` directly or used GitHub MCP tools instead of `gh-as-bot.mjs` ([SKILL.md](./skills/idd-implement/SKILL.md) specifies prioritizing `gh-as-bot.mjs`).
- **GitHub Project `Status` is not updated to `In Progress`**
  - **Personal (`User`) repository**: GitHub App Installation Tokens cannot access user-owned Projects v2, so `update-project-status.mjs` uses your local `gh` CLI. Run `gh auth refresh -s project` if the `project` scope is missing.
  - **Organization repository**: Ensure the GitHub App has **Organization permissions → Projects: `Read and write`** enabled and approved (**Accept new permissions**) on the Organization installation.
  - **Non-blocking warnings**: If the repository does not use Projects v2, the Issue is not registered in an open Project, or the Project's `Status` field has no `In Progress` option, `update-project-status.mjs` outputs a notice/warning and exits `0` so implementation continues.
