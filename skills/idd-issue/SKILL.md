---
name: idd-issue
description: Interactively brainstorms ideas or tasks with the user against the repository context, refines concrete specifications and acceptance criteria ready for `idd-implement`, previews the drafted Issue for explicit user confirmation, and creates the GitHub Issue directly as the locally authenticated `gh` CLI user.
---

# Issue-Driven Brainstorming & Creation Skill (`idd-issue`)

Starting from a user's rough idea, problem statement, or feature request, this skill guides an **interactive brainstorming session** grounded in the repository's codebase and conventions, organizes unambiguous requirements ready for `/idd-implement`, presents a full preview for explicit confirmation, and creates the GitHub Issue **as the locally authenticated GitHub user (`gh` CLI)**.

---

## Core Design & Authentication Rules

1. **Post Strictly as the Locally Authenticated `gh` User (Never as Bot)**:
   - Always inspect Issues, labels, and repository metadata—and create the final Issue—by invoking the local **`gh` CLI** directly (e.g., `gh auth status`, `gh issue list`, `gh label list`, `gh issue create`).
   - **Never** use `gh-as-bot.mjs`, `git-as-bot.mjs`, or GitHub App Bot credentials in this skill.
   - **Never** append `（🤖AIによる投稿）` to the Issue title or body (the Issue is authored interactively with the user and explicitly approved by the user before posting under their own account).
2. **Interactive Clarification & Mandatory Confirmation**:
   - Unlike `idd-implement` (which runs non-interactively), `idd-issue` is explicitly conversational.
   - Never run `gh issue create` without first showing the full drafted Issue preview (target repository, posting account, title, labels/assignees if any, and full Markdown body) and receiving explicit user approval.
3. **Read-Only Repository Exploration**:
   - Inspect files, templates, and git history strictly read-only. Never modify repository files, create commits, or switch git branches during `idd-issue`.
4. **Scope Boundary (No GitHub Projects v2 Operations)**:
   - Handle only standard `gh issue create` fields (title, body, and optional labels/assignees). Registering Issues into GitHub Projects (Projects v2) or updating Project `Status` is out of scope for this skill.

---

## Execution Steps

### 1. Receive Initial Input & Inspect Repository Context (Read-Only)
1. Take the user's initial idea or task description (if none was provided when invoking `/idd-issue`, ask what they want to build, fix, or improve).
2. Verify local GitHub CLI and repository context (read-only):
   - Check local authentication status and active account:
     ```bash
     gh auth status
     ```
     *(If `gh` is not logged in yet, inform the user early that `gh auth login` will be needed before posting, while still allowing brainstorming and drafting to proceed.)*
   - Verify the target repository:
     ```bash
     gh repo view --json nameWithOwner --jq .nameWithOwner
     ```
3. Inspect relevant project conventions and templates in the current repository:
   - Check project guides such as `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, and `README.ja.md` for Issue writing or architectural conventions.
   - Check `.github/ISSUE_TEMPLATE/` (Markdown `.md` or YAML `.yml`/`.yaml` templates) and `.github/ISSUE_TEMPLATE.md` if present.
4. Search/inspect the codebase and existing Issues (read-only):
   - Explore relevant source files, modules, and tests to understand technical feasibility, impacted areas, and existing patterns.
   - Check recent/related open Issues to avoid duplicates and identify dependencies:
     ```bash
     gh issue list --state open --limit 30 --json number,title,labels,url
     ```
   - When label assignment may be useful, inspect available repository labels:
     ```bash
     gh label list --json name,description
     ```

### 2. Interactive Brainstorming & Requirement Refinement
Collaborate with the user through focused, structured back-and-forth dialogue to turn the initial idea into concrete, implementation-ready requirements.

- **Keep questions focused and digestible**: Do not dump a massive questionnaire all at once. Summarize what is already clear from the user's prompt and repository inspection, then ask only the high-impact questions needed next—offering concrete options with a recommendation grounded in the codebase whenever design choices exist.
- **Cover the dimensions needed for `/idd-implement` readiness** (so subsequent implementation does not stall on ambiguities):
  1. **Background & Purpose**: Problem being solved, target users/scenarios, motivation.
  2. **Requirements & Specifications**: Expected behavior, inputs/outputs, CLI/UI/API design, edge cases, and error handling.
  3. **Out of Scope (Non-Goals)**: Explicit boundaries of what will *not* be included in this Issue.
  4. **Technical Considerations & Affected Areas**: Relevant files/modules discovered in the codebase, compatibility or dependency constraints, and agreed design approach.
  5. **Acceptance Criteria / Verification**: Observable conditions and tests/checks that define "done".
- Continue refining until both you and the user agree that requirements and boundaries are clear.

### 3. Draft the Issue & Present Mandatory Preview
1. **Format the Issue**:
   - **Language**: Write the Issue title and body in the same language used in your conversation with the user (e.g., Japanese when brainstorming in Japanese, English when in English), unless repository guidelines specify a fixed Issue language.
   - **Template selection**:
     - If `.github/ISSUE_TEMPLATE/` contains a matching template for the task type, follow its sections and field structure.
     - Otherwise, use the **Default Structured Issue Template** below.
   - **Optional metadata**: Suggest relevant existing labels (from `gh label list`) or assignees (e.g., `@me`) only if helpful or requested—never assume or silently create new labels.
2. **Present the Complete Preview**:
   Show the exact content that will be posted:
   - **Target Repository**: `<owner>/<repo>`
   - **Posting User**: `<local-gh-login>` (from `gh auth status` / `gh api user --jq .login`)
   - **Title**: `<draft-title>`
   - **Labels / Assignees**: `<labels-or-none>` / `<assignees-or-none>`
   - **Body**: Full Markdown preview
3. **Request Explicit Confirmation**:
   Ask the user whether to post this Issue as shown or whether they would like any adjustments.
   - If the user requests changes, revise the draft and display the updated preview again.
   - **Never proceed to Step 4 without explicit user approval.**

### 4. Create the Issue as the Local `gh` User
1. Confirm local `gh` authentication is active (`gh auth status`). If not authenticated, preserve the finalized title and body in chat and instruct the user to run `gh auth login`, then wait for them to confirm before retrying.
2. Create the Issue directly with `gh issue create`, passing the Markdown body via stdin (`--body-file -`) so formatting, code fences, and backticks are preserved cleanly:
   ```bash
   gh issue create --title "<title>" --body-file - <<'EOF'
   <issue-body>
   EOF
   ```
   - Include `--label "<label1>,<label2>"` or `--assignee "<login>"` only if confirmed by the user in Step 3.
   - Do **not** invoke `gh-as-bot.mjs`, do **not** add `（🤖AIによる投稿）`, and do **not** call `update-project-status.mjs`.

### 5. Report Result & Suggest Next Step
1. Share the created Issue number, clickable GitHub URL, posting user account, and any applied labels/assignees.
2. Suggest the next step for autonomous implementation if desired:
   - e.g., `/idd-implement <issue-number>`

---

## Default Structured Issue Template

Use this structure when `.github/ISSUE_TEMPLATE/` does not define a specific template (localizing headings to match the Issue language):

```markdown
## Background & Purpose
- (Why this change is needed and what problem it solves)

## Requirements & Specifications
- (Concrete behavior, inputs/outputs, and scope of functionality)
- (Edge cases and error handling)

## Out of Scope
- (Items explicitly excluded from this Issue)

## Acceptance Criteria
- [ ] (Verifiable functional condition or expected behavior)
- [ ] (Tests, build, or documentation checks expected to pass)

## Additional Context / Related Files
- (Relevant files/modules in the repository, related Issues/PRs, or design decisions agreed during brainstorming)
```

---

## Strict Rules

- **Local `gh` User Only (No Bot / No AI Marker)**: Always execute Issue creation via `gh issue create` under the locally logged-in `gh` user. Never call `gh-as-bot.mjs` or append `（🤖AIによる投稿）`.
- **Mandatory Preview & Explicit Approval**: Never execute `gh issue create` before displaying the full preview (target repository, posting account, title, metadata, and body) and receiving explicit confirmation from the user.
- **No Unfounded Assumptions**: Ground technical suggestions in files and Issues you actually inspected in the repository. Do not fabricate file paths, labels, or existing behaviors.
- **Read-Only Workspace**: Do not edit repository files, create branches, or create commits during `idd-issue`.
- **Out of Scope for Projects v2**: Do not register Issues into GitHub Projects v2 or modify Project statuses.
