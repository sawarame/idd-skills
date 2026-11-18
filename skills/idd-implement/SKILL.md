---
name: idd-implement
description: Autonomously inspects a GitHub Issue by number, posts a clarification comment and exits if anything is ambiguous, or—if requirements are clear—posts specifications and technical requirements as an Issue comment, implements and verifies changes (tests/build) in an isolated git worktree, opens a PR, and restores the original branch.
---

# Issue-Driven Implementation Skill (`idd-implement`)

Starting from a GitHub Issue number, this skill **runs autonomously (unattended) without pausing for user interaction or confirmation** and completes one of the following two outcomes end-to-end:

- **Goal A (When open questions or decisions are needed)**: Do not guess or proceed with implementation. Organize the items requiring clarification, post them directly as a comment on the target Issue, report what was posted, and exit.
- **Goal B (When implementation requirements are clear)**: Before writing code, **organize the specifications and technical requirements and post them as a comment on the target Issue**. Then create an isolated working environment using **`git worktree`** so other work is unaffected, and complete implementation, test/build verification, and PR (Pull Request) creation end-to-end. After creating the PR, clean up the temporary worktree and **always return to the original branch and original working state**.

> **Note**: This skill does not use Spec Kit (`speckit-specify` / `speckit-plan` / `speckit-task`). Specifications and technical requirements are recorded directly as an Issue comment before proceeding with implementation.

---

## Prerequisites, Tools, and Project Conventions

Before starting work, verify the environment and project structure.

1. **GitHub Issue / PR Operations (Prioritize the Bot Authentication Wrapper)**:
   - To inspect Issues, post Issue comments, and create PRs, run the **`gh` CLI** through the bundled wrapper script `scripts/gh-as-bot.mjs` (located alongside this `SKILL.md`, typically `~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs`):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs <gh-subcommand-and-args...>
     ```
   - **If `~/.config/github-app/.env` exists**, this wrapper generates an Installation Access Token from the configured GitHub App ID and `.pem` private key and runs `gh` **as the Bot (`GH_TOKEN`)**. **If it does not exist**, it executes `gh` as the locally authenticated `gh` user as usual.
   - **Security Prohibition**: Never directly read the contents of `~/.config/github-app/.env` or `.pem` private key files as an agent (all authentication handling must remain encapsulated inside `gh-as-bot.mjs`).
   - **GitHub MCP Tools**: GitHub MCP tools do not read `~/.config/github-app/.env` and would post under the personal account; therefore, avoid them by default and use `gh-as-bot.mjs` instead (only fall back to GitHub MCP tools in environments where `~/.config/github-app/.env` does not exist and the `gh` CLI is unavailable).
   - As a pre-check, confirm that the current repository is linked to the target GitHub repository, and if `~/.config/github-app/.env` does not exist, confirm authentication via `gh auth status`.
2. **Project Conventions**:
   - If the repository contains contribution guidelines, development guides, or rule definitions (such as `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `.github/pull_request_template.md`, etc.), follow those conventions throughout design, implementation, testing, and PR creation.

---

## Execution Steps

### 1. Identify the Issue Number, Record Current State, and Inspect the Issue
1. Obtain the specified Issue number (e.g., `#123` / `123`). If no Issue number is provided, do not ask interactively; output a message stating that no Issue number was specified and exit.
2. Record the **original repository root path** and **original branch name** (`git branch --show-current`) at the start. Do not modify any uncommitted changes or the checked-out branch in the original working directory.
3. Fetch the full details of the Issue (title, body, labels, state, assignees, **all existing comments**, referenced links, and related Issues/PRs) to thoroughly understand the requirements, background, and prior discussion.
   - Example: `node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue view <issue-number> --comments` (or `--json title,body,labels,state,comments`)
4. Inspect the repository's current codebase and related documentation to understand how the Issue relates to the existing architecture and implementation.

### 2. Review Open Questions / Decisions and Branch Accordingly
Cross-check the Issue details (including existing comments) against the codebase and examine the following:

- Functional boundaries (what is in and out of scope for this task)
- Inputs, outputs, error handling, and edge-case behavior
- Areas with multiple valid options requiring design decisions (UI, API, data models, etc.)
- Contradictions or conflicts with existing specifications or project conventions

**If decisions are needed or open questions are found**:
1. Structure the points into "Open Questions / Decisions Needed", "Possible Options (include a recommended option with rationale if applicable)", and "Impact on Implementation".
2. Compose a comment for the target Issue and post it directly **without asking the user for prior confirmation or permission**.
   - Example: `node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue comment <issue-number> --body "<comment-body>"`
3. **Exit Decision (Goal A Complete — Do Not Wait for Replies)**:
   - When specifications or implementation direction cannot be finalized, **stop without proceeding to implementation** as soon as the comment is posted to the Issue, and output the posted comment and the Issue URL in your final report. Do not ask the user for answers in chat or pause waiting for a response.

**If implementation requirements are sufficiently clear**:
- Do not post unnecessary clarification comments; proceed directly to Step 3.

> **Note**: **At any point** during Steps 3–5, if a new decision point or ambiguity is discovered, similarly post a comment to the Issue; if implementation cannot continue, clean up any created worktree, return to the original directory and original branch, exit, and report.

### 3. Document Pre-Implementation Specifications & Technical Requirements as an Issue Comment
Before starting implementation, articulate the planned implementation based on the Issue requirements and codebase investigation, and **record it as a comment on the target Issue**.

1. Concisely and clearly organize the following aspects (see the template example below):
   - **Specifications & Functional Requirements**: Behavior to implement, scope, inputs, outputs, and error handling
   - **Technical Requirements & Design Approach**: Chosen approach, files/modules to modify or add, and impact on data structures, APIs, and dependencies
   - **Verification Plan**: Tests to add/update and build/check commands to run
2. **Without asking the user for prior permission**, post the organized summary directly as a comment on the target Issue.
   - Example: `node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue comment <issue-number> --body "<spec-and-tech-requirements-comment>"`
3. After posting, proceed immediately to Step 4 without waiting for confirmation.

### 4. Set Up an Isolated Working Environment with `git worktree`
To avoid affecting any ongoing work in the original working directory (such as uncommitted changes or the currently checked-out branch), **create a dedicated working directory and branch using `git worktree`**.

1. Run `git fetch origin` (or equivalent) to check the latest base branch (typically the repository's default branch `origin/main` / `origin/master`, or the base branch defined by project conventions).
2. Choose a new working branch name following the project's naming conventions (e.g., `feat/issue-<issue-number>-<summary>` or `fix/issue-<issue-number>-<summary>`; if a working branch for the Issue already exists, use it).
3. Create the worktree at a path that does not pollute the original repository's working tree or `git status` (e.g., `../.worktrees/<repo>-issue-<issue-number>` under the repository's parent directory, or a `.gitignore`d `.worktrees/` directory if configured in the project).
   - Example: `git worktree add -b <working-branch> <worktree-path> <base-branch>`
   - *Note: Because the same branch cannot be checked out in multiple worktrees simultaneously, always create (or specify) a dedicated branch for the Issue.*
4. **Execute all subsequent steps (Steps 5–6: implementation, test/build verification, commit, push, and PR creation) inside this created worktree directory.** Do not edit files in the original working directory.

### 5. Implement and Verify (Inside the Worktree)
1. Implement the code and tests inside the worktree directory in accordance with the specifications and technical requirements posted to the Issue in Step 3.
2. If you encounter an unexpected edge case or specification gap during implementation where multiple interpretations exist, do not alter specifications arbitrarily—post the ambiguity/decision point directly as an Issue comment (if you cannot complete implementation as-is, do not create a PR; clean up the worktree, return to the original directory and original branch, exit, and report).
3. After completing implementation, run all verification commands defined in the project inside the worktree directory (check `package.json` scripts, `Makefile`, `.github/workflows/` CI definitions, etc. for unit tests, integration tests, build checks, type checks, lint, etc.).
   - If dependencies (such as `node_modules`) are not yet installed in the worktree, install what is needed for testing and building (e.g., `npm ci`) before running checks.
   - If any tests or build checks fail, fix all issues and repeat verification until **every check passes**.

### 6. Commit, Push, Create a PR (Pull Request), and Restore the Original Branch
1. **Pre-check**: Confirm that all unit tests and build checks (including lint, type checks, etc.) defined in the project have passed. If any check has not been run or is failing, do not create a PR—return to Step 5 and resolve it.
2. Confirm that the worktree is on the working branch (not the default branch).
3. Stage the modified implementation and test files, and create a commit following the project's commit conventions (or Conventional Commits).
4. Push the working branch to the remote repository (e.g., `git push -u origin <branch-name>`).
5. **Without asking the user for prior permission**, run `gh pr create` via `gh-as-bot.mjs` to create a regular (non-draft) PR (explicitly pass the base branch from Step 4 to `--base`).
   - Example: `node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs pr create --base "<base-branch>" --head "<working-branch>" --title "<title>" --body "<body>"`
   - If the project has a PR template such as `.github/pull_request_template.md`, follow its structure.
   - In the PR body, clearly include a reference to the target Issue (e.g., `Closes #<issue-number>`), a summary of the implementation (referencing the specifications and technical requirements posted to the Issue in Step 3), and **the exact test/build check commands run and their results**.
6. **Clean Up the Working Worktree and Restore the Original Branch**:
   - Change the current working directory back to the **original repository root** recorded in Step 1.
   - Remove and clean up the temporary worktree (e.g., `git worktree remove <worktree-path>`, and `git worktree prune` if needed). *Because changes have already been committed and pushed, the worktree can be safely removed (if untracked files such as installed dependencies prevent removal, inspect and clean up unneeded build/dependency artifacts before removing).*
   - In the original repository root, check `git branch --show-current` and ensure you are **back on the exact branch that was active at the start** (if it changed for any reason, restore it with `git checkout <original-branch>`).
7. Report the final results to the user (the referenced Issue, the Issue comment posted—either specifications/technical requirements or open questions—created/modified source files, test/build verification results, **the URL of the created PR**, and confirmation that the worktree was removed and the original branch was restored).

---

## Issue Comment Templates

Match the language of your comment to the language used in the existing Issue thread.

### 1. When Open Questions or Decisions Are Needed (Goal A)

```markdown
Before proceeding with implementation, the following points require clarification or a decision.

### 1. [Title of Clarification Item]
- **Background / Ambiguity**: (Which part of the specification or implementation is undefined)
- **Options**:
  - A: (Description and pros/cons of Option A)
  - B: (Description and pros/cons of Option B)
- **Recommendation**: (Recommended option and rationale)
```

### 2. Recording Pre-Implementation Specifications & Technical Requirements (Step 3)

```markdown
Before starting implementation on this Issue, I will proceed with the following specifications and technical requirements.

### Specifications & Functional Requirements
- (Expected behavior and target scope)
- (Edge cases and error handling behavior)

### Technical Requirements & Implementation Approach
- **Approach**: (Chosen design and implementation strategy)
- **Primary Target Files**: (Files/modules to be added or modified)
- **Impact / Considerations**: (Compatibility, dependencies, etc.)

### Verification Plan
- (Unit tests to add/update, build/lint/type checks to run, etc.)
```

---

## Strict Rules

- **Strictly Non-Interactive (No User Confirmation or Waiting for Replies)**: This skill is designed for unattended execution. Never ask the user for confirmation or permission mid-workflow, and never pause in chat waiting for a response. If there are ambiguities you cannot resolve, post a comment on the target Issue and exit.
- **No Spec Kit; Pre-Implementation Spec & Tech Requirements Comment Required**: Do not use Spec Kit in this skill. Even when requirements are clear, never jump straight into writing code—always organize the specifications and technical requirements and post them as an Issue comment before starting implementation.
- **Work Isolation via `git worktree` and Restoration of Original Branch**: Always perform implementation and verification inside a dedicated `git worktree` so the original working directory (any ongoing work or uncommitted changes) is completely untouched. After creating the PR (or upon early exit), always clean up the temporary worktree and return to the original working directory and original branch.
- **Passing Unit Tests and Build Checks Required**: Whenever the project defines unit tests or build checks (including lint, type checks, etc.), you must run and pass all of them before creating a PR. Creating a PR while tests or builds are failing or unverified is prohibited.
- **Automatic Posting of Issue Comments and PR Creation**: Post Issue comments (for open questions or specifications/technical requirements) and create the PR after implementation and verification (including committing and pushing the working branch) without requesting prior permission from the user, and include the results (posted content and PR URL) in the final report. Write clearly, accurately, and respectfully so third-party readers can easily understand the intent.
- **No Guessing Ambiguous Specifications**: Do not guess or invent specifications when design choices or requirements are unclear. Register open questions as a comment on the target Issue, report it, and exit.
- **No Destructive Git Operations**: Committing to the working branch, pushing the working branch, and creating a PR are permitted, but never push directly to default branches (`main` / `master`, etc.), force-push (`git push --force`), merge PRs, or directly close Issues unless explicitly instructed by the user.
