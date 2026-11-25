# idd-implement

[English](./README.md) | [日本語](./README.ja.md)

An autonomous, non-interactive skill ([`SKILL.md`](./SKILL.md)) that starts from an existing GitHub Issue number or Pull Request number and executes the entire workflow end-to-end—inspecting requirements or review feedback, implementing and verifying changes inside an isolated `git worktree`, opening or updating Pull Requests, and restoring your original branch.

---

## Usage & Prompt Examples

Invoke this skill in your AI coding agent using `/idd-implement` or by referring to `idd-implement` in natural language.

### 1. Implement a New Issue End-to-End

```text
/idd-implement #123
```

```text
Implement GitHub Issue #123 using idd-implement
```

### 2. Pass a Full GitHub Issue or PR URL

```text
/idd-implement https://github.com/owner/repo/issues/123
```

```text
/idd-implement https://github.com/owner/repo/pull/45
```

### 3. Respond to Pull Request Review Feedback

```text
/idd-implement PR #45
```

```text
Address the review comments on PR #45 using idd-implement
```

*(If you specify an Issue number that already has an open PR with pending review feedback, the skill automatically switches to PR Review Response Mode.)*

### 4. Resume Implementation After Answering Clarification Questions

If the skill stopped during Goal A, posted clarification questions, and attached the `question` label to `#123`, reply directly on the GitHub Issue and then run the same command again:

```text
/idd-implement #123
```

*(The skill reads your reply, removes the `question` label, and proceeds with implementation.)*

---

## Execution Modes

- **Goal A — Clarification Needed**: When requirements or review comments are ambiguous, the skill does not guess. It posts structured clarification questions directly on the Issue or PR, attaches the `question` label (for Issues), and exits cleanly.
- **Goal B — New Issue Implementation**: Posts specifications and technical requirements as an Issue comment → removes the `question` label (if present) → updates GitHub Project `Status` to `In Progress` (when configured) → implements and verifies all tests/builds in an isolated `git worktree` → commits, pushes, and opens a PR → updates Project `Status` to `In Review` (if available) → removes the worktree and restores the original branch.
- **Goal C — PR Review Response**: Inspects PR reviews, conversation comments, unresolved inline diff threads, and linked Issues → updates Project `Status` to `In Progress` → checks out the PR branch in an isolated `git worktree` → implements and verifies fixes → commits and pushes updates → replies to addressed inline comments, posts a PR summary comment, and requests re-review → updates Project `Status` to `In Review` → removes the worktree and restores the original branch.

---

## Key Notes, Prerequisites & Bundled Scripts

- **Prerequisites**:
  - **Node.js** (v18 or later; built-in modules only, no `npm install` required)
  - **GitHub CLI (`gh`)** (authenticated via `gh auth login` when not using a GitHub App, and with `project` scope for personal GitHub Projects v2)
  - **Git** (with `git worktree` support)
- **Strictly Non-Interactive**: Runs unattended without pausing for chat confirmation.
- **Isolated `git worktree`**: All edits, tests, builds, commits, and pushes run inside a temporary worktree so your active branch and uncommitted work stay untouched.
- **Bot Authentication & Local Fallback**:
  - When `~/.config/github-app/.env` is configured and valid, comments, PRs, and `git commit` / `git push` run as your GitHub App (`<app-name>[bot]`).
  - When unconfigured or Bot auth/permissions fail, the scripts warn and fall back to your local `gh` / `git` user, automatically adding a language-appropriate AI post marker to comments (`(🤖 Posted by AI)` for English, `（🤖AIによる投稿）` for Japanese).
- **Bundled Scripts (`scripts/`)**:
  - [`scripts/gh-as-bot.mjs`](./scripts/gh-as-bot.mjs): `gh` CLI wrapper with GitHub App Bot auth, local fallback, and automatic localized AI comment attribution
  - [`scripts/git-as-bot.mjs`](./scripts/git-as-bot.mjs): `git` wrapper for Bot commit identity and HTTPS Bot token push with local fallback
  - [`scripts/update-project-status.mjs`](./scripts/update-project-status.mjs): Non-blocking GitHub Projects (Projects v2) `Status` updater

---

## Setup & Full Plugin Documentation

For GitHub App creation steps, `~/.config/github-app/.env` and `.pem` setup, GitHub Projects v2 configuration, verification commands, and troubleshooting, see the main repository documentation:

- [Main README (English)](https://github.com/sawarame/idd-skills/blob/main/README.md)
- [Skill Specification (`SKILL.md`)](./SKILL.md)
