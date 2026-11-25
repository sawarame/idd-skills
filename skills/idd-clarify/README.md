# idd-clarify

[English](./README.md) | [日本語](./README.ja.md)

An interactive skill ([`SKILL.md`](./SKILL.md)) that inspects an existing GitHub Issue (along with all comments and your repository's codebase) by Issue number, identifies missing or ambiguous specifications, clarifies open questions with you through dialogue, and posts the finalized specifications as an Issue comment directly **as your locally authenticated `gh` CLI user**.

---

## Usage & Prompt Examples

Invoke this skill in your AI coding agent using `/idd-clarify` or by referring to `idd-clarify` in natural language.

### 1. Clarify Missing Specifications on an Existing Issue

```text
/idd-clarify #123
```

```text
Use idd-clarify to inspect GitHub Issue #123, identify any missing specifications, and help me finalize them.
```

### 2. Pass a Full GitHub Issue URL

```text
/idd-clarify https://github.com/owner/repo/issues/123
```

### 3. Resolve Open Questions Left by `idd-implement` (Goal A / `question` Label)

When `/idd-implement #123` stops with clarification questions and attaches the `question` label, use `idd-clarify` to walk through those questions interactively and post the finalized answers:

```text
/idd-clarify #123
```

*(The agent reads the Issue and all existing comments, clarifies every unresolved point with you, previews the finalized specification comment, and offers to remove the `question` label once approved.)*

### 4. Hand Off to `idd-implement` After Finalizing Specifications

Once the finalized specification comment is posted on `#123`, trigger autonomous implementation with:

```text
/idd-implement #123
```

---

## Workflow Overview

1. **Read-Only Issue & Repository Inspection**: Checks `gh auth status`, fetches the target Issue and all existing comments via `gh issue view <issue-number> --comments`, and inspects project conventions and relevant source files without editing files or switching branches.
2. **Specification Gap Analysis**: Identifies ambiguities or missing details across scope/non-goals, functional behavior, edge cases/error handling, technical design choices, acceptance criteria, and any unanswered thread questions.
3. **Interactive Clarification Dialogue**: Summarizes what is already clear, then walks through high-impact ambiguities with concrete codebase-grounded options and recommendations.
4. **Mandatory Full Preview & Confirmation**: Displays the target repository, Issue, posting `gh` account, optional `question` label removal (when attached), and full Markdown comment body, then waits for your explicit approval.
5. **Post Comment as Local `gh` User**: Posts the finalized specification directly with `gh issue comment` under your personal `gh` account (and removes the `question` label if confirmed).
6. **Report & Next Step**: Returns the posted comment/Issue URL and suggests `/idd-implement <issue-number>`.

---

## Key Notes & Prerequisites

- **Prerequisites**:
  - **GitHub CLI (`gh`)** authenticated via `gh auth login`
  - Running inside a local Git repository linked to a GitHub remote
- **Local `gh` User Only**: Never uses `gh-as-bot.mjs` or a GitHub App Bot, and never appends an AI post marker such as `(🤖 Posted by AI)`.
- **Preserves Original Issue Description**: Posts finalized specifications as a new comment (`gh issue comment`) rather than overwriting the Issue body.
- **Safe & Read-Only**: Never edits repository files, creates branches, or creates commits during clarification.
- **Language Matching**: Writes the comment in the same language as the existing Issue thread (unless repository guidelines require a specific language).
- **Projects v2 Out of Scope**: Does not register Issues into GitHub Projects v2 or modify Project statuses.

---

## Setup & Full Plugin Documentation

For installation instructions (`Antigravity` global plugin or `git subtree` per-repository setup) and details on pairing `idd-clarify` with `idd-issue` and `idd-implement`, see the main repository documentation:

- [Main README (English)](https://github.com/sawarame/idd-skills/blob/main/README.md)
- [Skill Specification (`SKILL.md`)](./SKILL.md)
