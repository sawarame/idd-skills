---
name: idd-implement
description: Autonomously inspects a GitHub Issue or Pull Request by number: for Issues, posts a clarification comment with a `question` label and exits if anything is ambiguous, or posts specifications and technical requirements, removes `question`, sets Project Status to `In Progress`, implements and verifies changes in an isolated git worktree, opens a PR, and updates Project Status to `In Review`; for PRs (or Issues with an existing open PR that has review feedback), inspects all PR reviews and inline review threads, applies fixes and verifies in a git worktree, pushes updates, replies to review comments, updates Project Status, and restores the original branch.
---

# Issue-Driven Implementation Skill (`idd-implement`)

Starting from a GitHub Issue number or Pull Request number, this skill **runs autonomously (unattended) without pausing for user interaction or confirmation** and completes one of the following outcomes end-to-end:

- **Goal A (When open questions or decisions are needed)**: Do not guess or proceed with implementation. Organize the items requiring clarification, post them directly as a comment on the target Issue (or target PR when responding to ambiguous PR review feedback), attach the `question` label to the Issue when applicable (without changing the GitHub Project status to `In Progress`/`In Review`), report what was posted, and exit.
- **Goal B (When implementing an Issue without an existing open PR)**: Before writing code, **organize the specifications and technical requirements and post them as a comment on the target Issue**. Immediately before setting up the worktree and starting implementation, remove the `question` label if it is currently attached, and update the Issue's GitHub Project (Projects v2) `Status` to `In Progress` if the repository/Issue uses GitHub Projects (non-blocking: warn and continue if unregistered or unavailable). Then create an isolated working environment using **`git worktree`** so other work is unaffected, and complete implementation, test/build verification, and PR (Pull Request) creation end-to-end. After creating the PR, update the GitHub Project `Status` to `In Review` if that option exists in the Project, clean up the temporary worktree, and **always return to the original branch and original working state**.
- **Goal C (When responding to PR review feedback on an existing PR)**: When invoked with a PR number—or with an Issue number that already has an open PR with review feedback (`CHANGES_REQUESTED`, unresolved inline review threads, or reviewer comments)—inspect all PR reviews, conversation comments, and inline diff review threads (plus any linked Issue). If review feedback is ambiguous, execute Goal A on the PR and exit. Otherwise, update the linked Issue's Project `Status` to `In Progress` (when applicable), check out the PR's existing branch inside an isolated **`git worktree`**, implement and verify the fixes (tests/build), commit and push to the PR branch, reply to addressed inline review comments and post a PR summary comment, optionally re-request review, update Project `Status` back to `In Review` (if available), clean up the temporary worktree, and **always return to the original branch and original working state**.

> **Note**: This skill does not use Spec Kit (`speckit-specify` / `speckit-plan` / `speckit-task`). Specifications and technical requirements are recorded directly as an Issue comment before proceeding with implementation, and PR review responses are recorded directly on the PR.

---

## Prerequisites, Tools, and Project Conventions

Before starting work, verify the environment and project structure.

1. **GitHub Issue / PR Operations (Prioritize the Bot Authentication Wrapper)**:
   - To inspect Issues, post Issue comments, and create PRs, run the **`gh` CLI** through the bundled wrapper script `scripts/gh-as-bot.mjs` (located alongside this `SKILL.md`, typically `~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs`):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs <gh-subcommand-and-args...>
     ```
   - **If `~/.config/github-app/.env` exists and Bot authentication succeeds**, this wrapper generates an Installation Access Token from the configured GitHub App ID and `.pem` private key and runs `gh` **as the Bot (`GH_TOKEN`)**. **If GitHub App information is missing or Bot authentication fails**, it logs a warning and falls back to executing `gh` as the locally authenticated `gh` user.
   - **AI Attribution on Local User Fallback**: Whenever a comment is posted as the locally authenticated user (because GitHub App configuration is absent or Bot authentication fails), the comment must include `（🤖AIによる投稿）` immediately after its first heading so readers can identify it as an AI-authored comment (e.g., `### Specifications & Functional Requirements（🤖AIによる投稿）`). `gh-as-bot.mjs` automatically appends `（🤖AIによる投稿）` after the first heading of `issue comment` / `pr comment` / `pr review` bodies and `api` comment/reply `body` fields when falling back to the local user (and omits it when posting as the Bot). Therefore, always structure comments with a Markdown heading (as in the templates below) when appropriate and let `gh-as-bot.mjs` handle the attribution automatically.
   - **Security Prohibition**: Never directly read the contents of `~/.config/github-app/.env` or `.pem` private key files as an agent (all authentication handling must remain encapsulated inside `gh-as-bot.mjs`).
   - **GitHub MCP Tools**: GitHub MCP tools do not read `~/.config/github-app/.env` and would post under the personal account; therefore, avoid them by default and use `gh-as-bot.mjs` instead (only fall back to GitHub MCP tools in environments where `gh` CLI is unavailable—and in that case, manually append `（🤖AIによる投稿）` right after the first heading of any posted comment).
   - As a pre-check, confirm that the current repository is linked to the target GitHub repository, and if Bot authentication is unconfigured or unavailable, confirm local authentication via `gh auth status`.
2. **GitHub Projects (Projects v2) Status Helper**:
   - To update the Issue's GitHub Project `Status` field (e.g., to `In Progress`) when starting implementation, use the bundled helper script `scripts/update-project-status.mjs`:
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/update-project-status.mjs <issue-number> --status "In Progress"
     ```
   - For **Organization** repositories, the script uses the GitHub App Bot token when configured (requiring **Organization permissions → Projects: Read and write** on the App).
   - For **personal (`User`)** repositories, GitHub App Installation Access Tokens cannot access user-owned Projects v2, so the script automatically uses the locally authenticated `gh` CLI (requiring the `project` scope, e.g., `gh auth refresh -s project`).
   - Status updates are non-blocking: if the repository does not use GitHub Projects, or if the Issue is unregistered, lacks an `In Progress` option, or lacks Project permissions, the script outputs a notice/warning and exits `0` so implementation proceeds.
3. **Project Conventions**:
   - If the repository contains contribution guidelines, development guides, or rule definitions (such as `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `.github/pull_request_template.md`, etc.), follow those conventions throughout design, implementation, testing, and PR creation.

---

## Execution Steps

### 1. Identify Target (Issue or PR), Record Current State, and Inspect Details
1. Obtain the specified Issue or Pull Request number (e.g., `#123` / `123`, `PR #45`, or a GitHub Issue/PR URL). If no number is provided, do not ask interactively; output a message stating that no Issue or PR number was specified and exit.
2. Record the **original repository root path** and **original branch name** (`git branch --show-current`) at the start. Do not modify any uncommitted changes or the checked-out branch in the original working directory.
3. Determine whether the target enters **PR Review Response Mode (Goal C)** or **New Issue Implementation Mode (Goal A / Goal B)**:
   - **If a PR number/URL is explicitly specified**, inspect the PR directly:
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs pr view <pr-number> --json number,title,body,state,isDraft,headRefName,baseRefName,isCrossRepository,reviewDecision,url,comments,reviews,closingIssuesReferences
     ```
     - If the PR is `MERGED` or `CLOSED`, report its current state and exit without making changes (unless a separate open Issue requires implementation).
     - Also fetch **inline diff review comments and review thread resolution status** (note that `pr view` does not include inline line-level comments or `isResolved` status):
       ```bash
       node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api repos/{owner}/{repo}/pulls/<pr-number>/comments
       ```
       And check `reviewThreads` via GraphQL (`isResolved`, `path`, `line`, `comments`) so already-resolved threads are not re-worked unnecessarily.
     - If `closingIssuesReferences` (or `Closes #...` in the PR body) identifies linked Issue(s), inspect those Issues as well via `gh-as-bot.mjs issue view <issue-number> --comments` to preserve original specifications and context.
     - Proceed via **PR Review Response Mode (Steps R1–R4)** below.
   - **If an Issue number is specified**:
     1. Fetch the full details of the Issue (title, body, labels, state, assignees, **all existing comments**, referenced links, and related Issues/PRs):
        ```bash
        node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue view <issue-number> --comments
        ```
     2. Check whether an **open PR** linked to this Issue already exists (via `gh-as-bot.mjs pr list --state open --search "#<issue-number>" --json number,title,headRefName,url` or GraphQL `closedByPullRequestsReferences` / timeline cross-references).
     3. If an open PR exists for the Issue, inspect that PR's reviews, conversation comments, and inline review comments/threads (using the PR commands above).
        - If the PR has actionable review feedback (`CHANGES_REQUESTED`, unresolved review threads, or new reviewer comments requesting modifications), enter **PR Review Response Mode (Steps R1–R4)**.
        - If the PR is already open and has no pending review feedback, report the existing PR status/URL and exit without creating a duplicate PR.
     4. If no open PR exists for the Issue, continue in **New Issue Implementation Mode (Steps 2–6)**.
4. Inspect the repository's current codebase and related documentation to understand how the Issue or PR changes relate to the existing architecture and implementation.

---

### PR Review Response Mode (Steps R1–R4)

Follow these steps when responding to review feedback on an existing open PR (Goal C).

#### R1. Triage Review Feedback and Check for Ambiguities
1. Review all feedback on the PR:
   - `reviews` (focusing on `CHANGES_REQUESTED`, `COMMENTED`, and review summary bodies)
   - Top-level `comments` on the PR
   - Unresolved inline `reviewThreads` / `pulls/<pr-number>/comments` (skip threads already marked `isResolved: true` and skip your own previous Bot/AI replies)
   - Latest commit timestamps on the PR branch so you distinguish already-addressed feedback from new feedback.
2. Check `isCrossRepository` on the PR: if the PR originates from a fork where you do not have push access to the fork branch, report this limitation and exit cleanly without modifying local branches.
3. If any review comment is ambiguous, contradicts the linked Issue's specifications, or requires a design decision that cannot be safely resolved from the codebase:
   - Do **not** guess or apply speculative changes.
   - Post clarification questions directly on the PR (via `gh-as-bot.mjs pr comment <pr-number> --body "..."`, or inline reply via `gh-as-bot.mjs api repos/{owner}/{repo}/pulls/<pr-number>/comments/<comment-id>/replies -f body="..."`).
   - If a linked Issue exists, optionally add the `question` label on the Issue (`gh-as-bot.mjs issue edit <issue-number> --add-label "question"`). Do not change Project Status to `In Progress` or `In Review`.
   - Report what was posted and exit (Goal A complete).
4. If no actionable review items remain (all feedback is already addressed or resolved), report that status and exit without making empty commits.

#### R2. Prepare Project Status and Worktree on the Existing PR Branch
1. If a linked Issue exists and the `question` label is attached, remove it (`gh-as-bot.mjs issue edit <issue-number> --remove-label "question"`).
2. If a linked Issue exists and GitHub Projects v2 is used, update the Issue's Project `Status` to `In Progress` immediately before modifying code:
   ```bash
   node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/update-project-status.mjs <issue-number> --status "In Progress"
   ```
3. Run `git fetch origin` to get the latest remote commits on the PR branch (`origin/<headRefName>`) and base branch (`origin/<baseRefName>`).
4. Create an isolated `git worktree` at `../.worktrees/<repo>-pr-<pr-number>` (or `.worktrees/` if `.gitignore`d) checked out on the PR's existing branch:
   - If `<headRefName>` is **not** currently checked out in another worktree or the original repository root:
     - If local branch `<headRefName>` exists: `git worktree add <worktree-path> <headRefName>` (and fast-forward to `origin/<headRefName>` with `git merge --ff-only origin/<headRefName>` if behind).
     - Otherwise: `git worktree add -b <headRefName> <worktree-path> origin/<headRefName>`.
   - If `<headRefName>` **is** already checked out in the original repository root (e.g., user had it open):
     - Do not touch the original working directory; create a detached worktree at `origin/<headRefName>`: `git worktree add --detach <worktree-path> origin/<headRefName>`, and push using `git push origin HEAD:<headRefName>` in Step R4.
5. **Execute all implementation, verification, commit, and push operations inside this worktree directory.**

#### R3. Implement Review Fixes and Verify (Inside the Worktree)
1. Implement fixes for every actionable review comment while preserving existing behavior and linked Issue requirements.
2. Add or update unit/integration tests covering the review feedback and edge cases.
3. Run all verification commands defined in the project (unit tests, integration tests, build, type checks, lint) inside the worktree until **every check passes**.
   - If an unexpected ambiguity is discovered mid-fix, post a clarification comment on the PR, clean up the worktree, restore the original branch, exit, and report.

#### R4. Commit, Push, Reply to PR Reviews, Update Status, and Restore Branch
1. Confirm all tests and build checks pass, then stage and commit your changes in the worktree following the project's commit conventions.
2. Push to the existing PR branch (`git push origin <headRefName>`, or `git push origin HEAD:<headRefName>` if detached; never force-push unless explicitly instructed).
3. **Reply to Review Comments and Post a Summary on the PR (Without Asking Confirmation)**:
   - For each addressed inline review comment (`<comment-id>` from `pulls/<pr-number>/comments`), post a concise reply explaining the fix and referencing the commit SHA:
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api repos/{owner}/{repo}/pulls/<pr-number>/comments/<comment-id>/replies -f body="<reply-body>"
     ```
     *(Do not forcibly resolve human reviewers' threads unless explicitly requested; leave them for the reviewer to verify and resolve.)*
   - Post an overall PR summary comment listing all addressed review points, modified files, commit SHA(s), and exact verification commands/results (see the PR Review Response Template below):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs pr comment <pr-number> --body "<pr-review-response-summary>"
     ```
4. **Re-request Review (Best-Effort / Non-Blocking)**:
   - If any reviewers submitted `CHANGES_REQUESTED`, request re-review where supported (if it fails—for example, when the reviewer is the PR author or lacks permissions—log a warning and continue):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs api repos/{owner}/{repo}/pulls/<pr-number>/requested_reviewers -f "reviewers[]=<reviewer-login>"
     ```
5. **Update GitHub Project Status to `In Review` (If Linked Issue & Option Exists)**:
   - If a linked Issue exists, run:
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/update-project-status.mjs <issue-number> --status "In Review" --optional
     ```
6. **Clean Up the Worktree and Restore the Original Branch**:
   - Return to the **original repository root**, remove the temporary worktree (`git worktree remove <worktree-path>` and `git worktree prune` if needed), verify `git branch --show-current` matches the **original branch**, and restore it if needed.
7. Report the final results to the user (PR URL, linked Issue if any, addressed review items, inline replies & summary comment posted, modified files, commit SHA, test/build verification results, Project status updates/warnings, and confirmation that the worktree was removed and the original branch was restored).

---

### New Issue Implementation Mode (Steps 2–6)

Follow Steps 2–6 when implementing an Issue that does not yet have an open PR.

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
3. **Attach the `question` Label (Do Not Change Project Status)**:
   - Add the `question` label to the Issue via `gh-as-bot.mjs` (if the `question` label does not exist in the repository yet, create it first and retry; if label creation/assignment fails, include a warning in the final report and continue):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue edit <issue-number> --add-label "question"
     ```
   - Do **not** update the GitHub Project status when exiting for open questions.
4. **Exit Decision (Goal A Complete — Do Not Wait for Replies)**:
   - When specifications or implementation direction cannot be finalized, **stop without proceeding to implementation** as soon as the comment is posted and the `question` label is handled, and output the posted comment, label status, and the Issue URL in your final report. Do not ask the user for answers in chat or pause waiting for a response.

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
3. **Remove the `question` Label (If Present)**:
   - Check the Issue's labels fetched in Step 1. If the `question` label is attached, remove it via `gh-as-bot.mjs` (if removal fails, log a warning and continue):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/gh-as-bot.mjs issue edit <issue-number> --remove-label "question"
     ```
4. **Update GitHub Project Status to `In Progress` Immediately Before Implementation (When GitHub Projects v2 Is Used)**:
   - **Execute this immediately before proceeding to Step 4 (`git worktree`) and Step 5 (implementation)—never defer this until PR creation**:
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/update-project-status.mjs <issue-number> --status "In Progress"
     ```
   - The script automatically checks whether the repository/Issue uses open GitHub Projects (Projects v2). If not, it skips cleanly. If the Issue is not registered in an open Project, the `In Progress` option is missing, or Project permissions are insufficient, record the printed warning and **proceed with implementation**.
5. Only after completing Steps 3.1–3.4 above, proceed immediately to Step 4 without waiting for confirmation.

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
6. **Update GitHub Project Status to `In Review` (If That Option Exists)**:
   - Immediately after the PR is created, run `update-project-status.mjs` with `--optional` so that if the Project's `Status` field contains an `In Review` option, the Issue is moved to that status (if the option does not exist or Projects v2 is not used, it skips cleanly without failing):
     ```bash
     node ~/.gemini/config/plugins/idd-skills/skills/idd-implement/scripts/update-project-status.mjs <issue-number> --status "In Review" --optional
     ```
7. **Clean Up the Working Worktree and Restore the Original Branch**:
   - Change the current working directory back to the **original repository root** recorded in Step 1.
   - Remove and clean up the temporary worktree (e.g., `git worktree remove <worktree-path>`, and `git worktree prune` if needed). *Because changes have already been committed and pushed, the worktree can be safely removed (if untracked files such as installed dependencies prevent removal, inspect and clean up unneeded build/dependency artifacts before removing).*
   - In the original repository root, check `git branch --show-current` and ensure you are **back on the exact branch that was active at the start** (if it changed for any reason, restore it with `git checkout <original-branch>`).
8. Report the final results to the user (the referenced Issue, the Issue comment posted—either specifications/technical requirements or open questions—any `question` label or GitHub Project `Status` changes or warnings, created/modified source files, test/build verification results, **the URL of the created PR**, and confirmation that the worktree was removed and the original branch was restored).

---

## Comment Templates

Match the language of your comment to the language used in the existing Issue or PR thread.

> **Note**: The templates below include Markdown headings (`### ...`). When `gh-as-bot.mjs` falls back to the locally authenticated `gh` user (due to missing GitHub App config or failed Bot authentication), it automatically appends `（🤖AIによる投稿）` right after the first heading in the comment (e.g., `### Specifications & Functional Requirements（🤖AIによる投稿）`). If you ever post directly via GitHub MCP tools without `gh-as-bot.mjs`, append `（🤖AIによる投稿）` after the first heading manually.

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

### 3. PR Review Response Summary (Step R4)

```markdown
Addressed the review feedback on this PR.

### Summary of Changes
- **[Review Item / Comment Reference]**: (What was changed and commit SHA)

### Verification Results
- `<command>`: (Passed / summary of results)
```

---

## Strict Rules

- **Strictly Non-Interactive (No User Confirmation or Waiting for Replies)**: This skill is designed for unattended execution. Never ask the user for confirmation or permission mid-workflow, and never pause in chat waiting for a response. If there are ambiguities you cannot resolve, post a comment on the target Issue or PR and exit.
- **No Spec Kit; Pre-Implementation Spec & Tech Requirements Comment Required (for New Issues)**: Do not use Spec Kit in this skill. When implementing a new Issue (Goal B), never jump straight into writing code—always organize the specifications and technical requirements and post them as an Issue comment before starting implementation.
- **Work Isolation via `git worktree` and Restoration of Original Branch**: Always perform implementation, review fixes, and verification inside a dedicated `git worktree` so the original working directory (any ongoing work or uncommitted changes) is completely untouched. After creating or updating the PR (or upon early exit), always clean up the temporary worktree and return to the original working directory and original branch.
- **Passing Unit Tests and Build Checks Required**: Whenever the project defines unit tests or build checks (including lint, type checks, etc.), you must run and pass all of them before creating a PR or pushing PR review fixes. Creating a PR or pushing review fixes while tests or builds are failing or unverified is prohibited.
- **Automatic Posting of Comments, Review Replies, Labels, Project Status Updates, and PR Operations**: Post Issue/PR comments, inline PR review replies, toggle the `question` label (add on Goal A, remove on Goal B/C), update the GitHub Project `Status` to `In Progress` **immediately before starting implementation or review fixes (never deferring to PR creation)**, create the PR or push review fixes after verification, and update the GitHub Project `Status` to `In Review` after PR creation/review response if that option exists (non-blocking on warnings) without requesting prior permission from the user, and include the results (posted content, label/Project status outcomes or warnings, and PR URL) in the final report. Write clearly, accurately, and respectfully so third-party readers can easily understand the intent.
- **No Guessing Ambiguous Specifications or Review Feedback**: Do not guess or invent specifications when design choices, requirements, or review comments are unclear. Register open questions as a comment on the target Issue or PR, report it, and exit.
- **No Destructive Git Operations**: Committing to the working branch, pushing the working branch, and creating/updating a PR are permitted, but never push directly to default branches (`main` / `master`, etc.), force-push (`git push --force`), merge PRs, or directly close Issues unless explicitly instructed by the user.
