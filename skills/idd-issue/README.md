# idd-issue

[English](./README.md) | [日本語](./README.ja.md)

An interactive skill ([`SKILL.md`](./SKILL.md)) that turns rough ideas, problem statements, or task memos into well-structured, implementation-ready GitHub Issues through repository-aware brainstorming—and posts them directly **as your locally authenticated `gh` CLI user**.

---

## Usage & Prompt Examples

Invoke this skill in your AI coding agent using `/idd-issue` or by referring to `idd-issue` in natural language.

### 1. Brainstorm from a Rough Idea

```text
/idd-issue Add a dark mode toggle to the settings page
```

```text
Use idd-issue to brainstorm requirements and create a GitHub Issue for adding CSV export support.
```

### 2. Turn a Bug Report or Investigation Memo into an Issue

```text
/idd-issue Users are logged out when refreshing the dashboard page. Inspect the codebase and help me organize this into a GitHub Issue.
```

### 3. Start Interactively Without Details Upfront

```text
/idd-issue
```

*(The agent will ask what you want to build, fix, or improve, inspect the repository read-only, and guide you through focused questions.)*

### 4. Specify Scope Boundaries or Request Label Suggestions

```text
/idd-issue Refactor the export module to support streaming. Keep UI changes out of scope and suggest suitable existing labels.
```

### 5. Hand Off to `idd-implement` After Creating the Issue

Once the Issue is created (for example, `#123`), you can trigger autonomous implementation with:

```text
/idd-implement #123
```

---

## Workflow Overview

1. **Read-Only Repository Exploration**: Checks `gh auth status`, repository conventions (`CONTRIBUTING.md`, `AGENTS.md`, `README*`), `.github/ISSUE_TEMPLATE/`, relevant source files, open Issues (to avoid duplicates), and existing labels without editing files or switching branches.
2. **Interactive Brainstorming**: Refines background & purpose, concrete requirements/specifications, out-of-scope boundaries, technical considerations, and acceptance criteria through concise dialogue.
3. **Mandatory Full Preview & Confirmation**: Displays the target repository, posting `gh` account, title, optional labels/assignees, and full Markdown body, then waits for your explicit approval.
4. **Create Issue as Local `gh` User**: Posts directly with `gh issue create` under your personal `gh` account.
5. **Report & Next Step**: Returns the created Issue number and URL and suggests `/idd-implement <issue-number>`.

---

## Key Notes & Prerequisites

- **Prerequisites**:
  - **GitHub CLI (`gh`)** authenticated via `gh auth login`
  - Running inside a local Git repository linked to a GitHub remote
- **Local `gh` User Only**: Never uses `gh-as-bot.mjs` or a GitHub App Bot, and never appends an AI post marker such as `(🤖 Posted by AI)`.
- **Safe & Read-Only**: Never edits repository files, creates branches, or creates commits during brainstorming.
- **Language Matching**: Writes the Issue title and body in the same language as your conversation (unless repository guidelines require a specific language).
- **Projects v2 Out of Scope**: Only handles standard `gh issue create` fields (title, body, optional labels/assignees).

---

## Setup & Full Plugin Documentation

For installation instructions (`Antigravity` global plugin or `git subtree` per-repository setup) and details on pairing `idd-issue` with `idd-implement`, see the main repository documentation:

- [Main README (English)](https://github.com/sawarame/idd-skills/blob/main/README.md)
- [Skill Specification (`SKILL.md`)](./SKILL.md)
