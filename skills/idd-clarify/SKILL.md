---
name: idd-clarify
description: Interactively inspects an existing GitHub Issue (including its comments and codebase context) by Issue number, identifies missing or ambiguous specifications, clarifies open questions with the user through dialogue, previews the finalized specification comment for explicit confirmation, and posts it directly as the locally authenticated `gh` CLI user.
---

# Issue-Driven Specification Clarification Skill (`idd-clarify`)

Starting from an existing GitHub Issue number (or URL), this skill performs a **read-only inspection** of the Issue, all existing comments, and the repository's codebase to uncover missing or ambiguous specifications, guides an **interactive clarification dialogue** with the user to finalize decisions, presents a full preview for explicit confirmation, and posts the finalized specifications as an **Issue comment as the locally authenticated GitHub user (`gh` CLI)**.

This skill bridges rough Issues (or Issues paused by `/idd-implement` with open questions / a `question` label) and autonomous implementation via `/idd-implement`.

---

## Core Design & Authentication Rules

1. **Post Strictly as the Locally Authenticated `gh` User (Never as Bot)**:
   - Always inspect the Issue and post the finalized comment (and remove the `question` label if confirmed) by invoking the local **`gh` CLI** directly (e.g., `gh auth status`, `gh issue view`, `gh issue comment`, `gh issue edit`).
   - **Never** use `gh-as-bot.mjs`, `git-as-bot.mjs`, or GitHub App Bot credentials in this skill.
   - **Never** append an AI post marker (such as `(🤖 Posted by AI)` or `（🤖AIによる投稿）`) to the Issue comment (the finalized specification is confirmed interactively with the user and explicitly approved before posting under their own account).
2. **Interactive Clarification & Mandatory Confirmation**:
   - Unlike `idd-implement` (which runs non-interactively), `idd-clarify` is explicitly conversational.
   - Never run `gh issue comment` (or `gh issue edit`) without first showing the full drafted comment preview (target repository, target Issue number/title/URL, posting account, optional label action if applicable, and full Markdown comment body) and receiving explicit user approval.
3. **Comment-Only Recording (Preserve Original Issue Body)**:
   - Always record the finalized specifications as a **new comment** on the Issue (`gh issue comment`) rather than overwriting the original Issue description, preserving the full discussion history.
4. **Read-Only Repository Exploration**:
   - Inspect files, conventions, and git history strictly read-only. Never modify repository files, create commits, or switch git branches during `idd-clarify`.
5. **Scope Boundary (No GitHub Projects v2 Operations)**:
   - Registering Issues into GitHub Projects (Projects v2) or updating Project `Status` is out of scope for this skill.

---

## Execution Steps

### 1. Identify Target Issue & Inspect Issue and Repository Context (Read-Only)
1. Obtain the target GitHub Issue number or URL (e.g., `#123`, `123`, or `https://github.com/owner/repo/issues/123`).
   - If no Issue number was provided when invoking `/idd-clarify`, ask the user which Issue number they want to clarify (you may optionally list recent open Issues via `gh issue list --state open --limit 15 --json number,title,labels` to help them choose).
2. Verify local GitHub CLI authentication and repository context (read-only):
   - Check local authentication status and active account:
     ```bash
     gh auth status
     ```
     *(If `gh` is not logged in yet, inform the user early that `gh auth login` will be needed before posting, while still allowing exploration and clarification if the Issue content is accessible or provided.)*
   - Verify the target repository:
     ```bash
     gh repo view --json nameWithOwner --jq .nameWithOwner
     ```
3. Fetch the full details of the target Issue—title, body, state, labels, assignees, and **all existing comments**:
   ```bash
   gh issue view <issue-number> --comments
   ```
   *(You may also run `gh issue view <issue-number> --json number,title,body,state,labels,url,comments` for structured inspection.)*
   - If the Issue is `CLOSED`, inform the user of its state and confirm whether they still want to clarify specifications on it.
   - Pay special attention to existing comments—especially any open questions previously posted by reviewers or by `/idd-implement` (Goal A), and note whether the `question` label is currently attached.
4. Inspect relevant project conventions and codebase files (read-only):
   - Check project guides such as `CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, and `README.ja.md`.
   - Inspect relevant source files, types/schemas, configuration, and tests referenced by or related to the Issue so your gap analysis and recommendations are grounded in the actual codebase.

### 2. Gap Analysis — Identify Missing or Ambiguous Specifications
Cross-check the Issue description and all existing comments against the repository codebase, evaluating readiness for `/idd-implement` across these dimensions:

1. **Scope & Boundaries (Out of Scope)**: Are boundaries clear about what should and should *not* be changed?
2. **Functional Specifications & Interfaces**: Are expected behaviors, inputs/outputs, CLI/API/UI interactions, defaults, and backward compatibility clearly defined?
3. **Edge Cases & Error Handling**: Are boundary conditions, invalid inputs, failure modes, empty states, permissions, and fallback behaviors specified?
4. **Technical & Design Decisions**: Are there multiple valid implementation approaches, data models, naming choices, or dependency constraints that require an explicit decision?
5. **Acceptance Criteria & Verification**: Are observable "done" conditions and required tests/checks clearly defined?
6. **Unresolved Thread Questions**: Are there any open questions from previous comments (including `/idd-implement` Goal A comments) that still lack answers?

- **If no specification gaps remain**: Report clearly that the Issue (together with existing comments) is already sufficiently specified for implementation, summarize the confirmed understanding briefly, and suggest running `/idd-implement <issue-number>` (do not post a redundant comment unless the user explicitly asks to post a summary).

### 3. Interactive Clarification Dialogue
Guide the user through resolving every identified gap in a clear, structured conversation:

1. **Share Your Findings First**:
   - Briefly summarize what is already clear from the Issue, existing comments, and codebase.
   - List the missing or ambiguous specification points discovered, prioritized by impact.
2. **Ask Focused, Digestible Questions**:
   - Do not dump an overwhelming questionnaire all at once. Group related questions logically and clarify high-impact decisions first.
   - For each ambiguity or design decision, briefly explain *why* it matters in the context of the repository and present concrete options with a **recommended option and rationale** grounded in the codebase.
   - Keep track of agreed decisions and verify whether any answer introduces follow-up edge cases.
3. Continue until both you and the user agree that all essential specification gaps are resolved and unambiguous enough for `/idd-implement`.

### 4. Draft the Finalized Specification Comment & Present Mandatory Preview
1. **Format the Comment**:
   - **Language**: Write the comment in the same language used in the existing Issue thread (or the user's conversation language when appropriate/requested), unless repository guidelines specify a fixed language.
   - **Content**: Summarize only the newly clarified and finalized specifications clearly and concisely (using the **Default Specification Clarification Comment Template** below, omitting sections that are not applicable).
   - If the Issue had open questions from earlier comments (such as a prior `/idd-implement` Goal A comment), make sure every question has a clear, unambiguous answer reflected in the draft.
2. **Present the Complete Preview**:
   Show the exact content and actions to be executed:
   - **Target Repository**: `<owner>/<repo>`
   - **Target Issue**: `#<issue-number>` — `<issue-title>` (`<issue-url>`)
   - **Posting User**: `<local-gh-login>` (from `gh auth status` / `gh api user --jq .login`)
   - **Label Action (Optional)**: If the `question` label is currently attached to the Issue, propose removing it after posting (`gh issue edit <issue-number> --remove-label "question"`) and ask whether to include this action.
   - **Comment Body**: Full Markdown preview
3. **Request Explicit Confirmation**:
   Ask the user whether to post this comment as shown (and whether to remove the `question` label if applicable), or whether they would like any adjustments.
   - If the user requests changes, revise the draft and display the updated preview again.
   - **Never proceed to Step 5 without explicit user approval.**

### 5. Post the Issue Comment as the Local `gh` User
1. Confirm local `gh` authentication is active (`gh auth status`). If not authenticated, preserve the finalized comment body in chat and instruct the user to run `gh auth login`, then wait for them to confirm before retrying.
2. Post the comment directly with `gh issue comment`, passing the Markdown body via stdin (`--body-file -`) so formatting, code fences, and backticks are preserved cleanly:
   ```bash
   gh issue comment <issue-number> --body-file - <<'EOF'
   <comment-body>
   EOF
   ```
3. If the `question` label was attached and the user explicitly approved removing it in Step 4, remove it via local `gh`:
   ```bash
   gh issue edit <issue-number> --remove-label "question"
   ```
4. Do **not** invoke `gh-as-bot.mjs`, do **not** add an AI post marker (such as `(🤖 Posted by AI)` or `（🤖AIによる投稿）`), and do **not** call `update-project-status.mjs`.

### 6. Report Result & Suggest Next Step
1. Share the target Issue number, posted comment URL (or Issue URL), posting user account, and whether the `question` label was removed.
2. Suggest the next step for autonomous implementation if desired:
   - e.g., `/idd-implement <issue-number>`

---

## Default Specification Clarification Comment Template

Use this structure when composing the finalized specification comment (localizing headings to match the comment language, and omitting sections that do not apply):

```markdown
## Finalized Specifications & Clarifications

### Agreed Requirements & Behavior
- (Concrete behavior, inputs/outputs, and decisions finalized during clarification)

### Edge Cases & Error Handling
- (Agreed handling for boundary conditions, invalid inputs, and failure scenarios)

### Out of Scope
- (Items explicitly confirmed to be excluded from this Issue)

### Technical Decisions & Affected Areas
- (Agreed design approach, compatibility constraints, or relevant files/modules)

### Acceptance Criteria
- [ ] (Verifiable functional condition or expected behavior)
- [ ] (Tests, build, or documentation checks expected to pass)
```

---

## Strict Rules

- **Local `gh` User Only (No Bot / No AI Marker)**: Always post Issue comments via `gh issue comment` (and optional `question` label removal via `gh issue edit`) under the locally logged-in `gh` user. Never call `gh-as-bot.mjs` or append an AI post marker (such as `(🤖 Posted by AI)` or `（🤖AIによる投稿）`).
- **Mandatory Preview & Explicit Approval**: Never execute `gh issue comment` or `gh issue edit` before displaying the full preview (target repository, Issue, posting account, optional label action, and full Markdown comment body) and receiving explicit confirmation from the user.
- **Preserve Original Issue Description**: Always record finalized specifications as a new comment (`gh issue comment`) rather than overwriting the Issue body.
- **No Unfounded Assumptions**: Ground gap analysis and recommendations in the actual Issue content, existing comments, and files inspected in the repository. Do not fabricate file paths or existing behaviors.
- **Read-Only Workspace**: Do not edit repository files, create branches, or create commits during `idd-clarify`.
- **Out of Scope for Projects v2**: Do not register Issues into GitHub Projects v2 or modify Project statuses.
