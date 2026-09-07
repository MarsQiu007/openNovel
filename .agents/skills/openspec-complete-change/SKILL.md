---
name: openspec-complete-change
description: Finish a completed OpenSpec change by recording its implementation commits, validating and syncing specs, archiving it, merging to main, and cleaning up the feature branch.
---

Complete a finished OpenSpec change end to end. Use only when the user explicitly asks to complete, finalize, archive, or merge a specific OpenSpec change. If the user only asks to verify, sync, or update a proposal, use the corresponding narrower OpenSpec skill instead.

## Input

1. Resolve the change ID from the user request. If it is omitted, infer it only when conversation context or branch commits make it unambiguous; otherwise list active changes and ask.
2. If a store is named, pass the same `--store <id>` flag to every OpenSpec command that supports it.

## Preflight

1. Confirm the current branch is not `main` and `git status --porcelain` is empty.
2. Confirm `openspec/changes/<change-id>` exists and is active.
3. Confirm every task in `tasks.md` is complete.
4. Confirm the branch carries only commits for this change:
   - List branch commits from the merge base with `origin/main`.
   - Every non-merge implementation commit must have exactly one `OpenSpec-Change: <change-id>` trailer.
   - If any commit is missing a trailer, uses another ID, or uses `none`, stop and ask the user to isolate or repair history.
5. Announce: `Using change: <change-id>`.

## Verification

1. Run the tests relevant to the changed packages from their package directories.
2. Run `bun run typecheck` from the repository root.
3. Run `bun run lint` from the repository root.
4. If any check fails, stop without editing OpenSpec completion records.

Do not use `--no-verify`, do not force push, and do not bypass failed checks.

## Record implementation commits

1. Collect proposal commits:

   ```sh
   git log --grep "OpenSpec-Change: <change-id>" --format="%h %s"
   ```

2. Verify the list matches the expected implementation commits. It must exclude the upcoming record commit, spec sync commit, and archive move commit.
3. Add or replace an `## Implementation Commits` section at the end of `openspec/changes/<change-id>/tasks.md`. Use one list item per commit:

   ```md
   - `abc1234` feat(app): implement the requested behavior
   ```

4. Commit only this record update:

   ```txt
   docs(openspec): 记录 <change-id> 实现提交

   OpenSpec-Change: <change-id>
   ```

## Finalize OpenSpec

1. Run `openspec validate <change-id>`. Stop on failure.
2. If the change has delta specs, sync them into `openspec/specs` and verify the resulting main specs. Commit spec sync changes with the same `OpenSpec-Change: <change-id>` trailer.
3. Archive the change and commit the archive move. Use a conventional message such as `chore(openspec): 归档 <change-id>` with the same trailer.
4. Confirm the archived change directory exists under `openspec/changes/archive` and the active change no longer appears.

## Merge and clean up

1. Fetch and switch to `main`; update it with a fast-forward from `origin/main`.
2. Merge the feature branch into `main`, preferably with `git merge --ff-only <feature-branch>`.
3. If fast-forward is impossible, update the feature branch from latest `main`, rerun the same verification gate, then merge. Resolve conflicts only if the user has authorized this change to proceed; otherwise stop.
4. Push `main` to `origin`.
5. Verify the feature branch head is an ancestor of `main`.
6. Delete the local feature branch with `git branch -d`.
7. Delete the remote feature branch only if it exists.
8. Run `git fetch --prune`.
9. Confirm `git status` is clean.

## Report

Summarize the change ID, implementation commits, record commit, archive location, main merge/push result, deleted branches, and final branch. If the flow stopped, report the exact failed gate, affected commits, and the next manual action.