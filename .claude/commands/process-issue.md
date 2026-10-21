---
description: Plan, build, test and open a PR for one GitHub issue
argument-hint: <issue-number>
---

Process GitHub issue #$ARGUMENTS end to end. Work through the four phases in order.

## 1. PLAN
- Run `gh issue view $ARGUMENTS` and read the Goal, Acceptance Criteria, Implementation Notes, Dependencies and Out of Scope.
- Check that every dependency issue is closed and its PR merged. If one is not, stop and say which.
- Look for prior art: earlier plans in `scratchpads/`, related PRs (`gh pr list --state all --search "<keywords>"`), and the code the issue touches.
- Write the plan to `scratchpads/issue-$ARGUMENTS-<short-slug>.md`. Start it with the issue link, then list the steps, the files to change and how each acceptance criterion will be tested.
- Respect the safety rules: never auto-submit applications, never store EEO fields, flag rather than guess.

## 2. CREATE
- Start from up-to-date `main`: `git checkout main && git pull`, then `git checkout -b issue-$ARGUMENTS-<short-slug>`.
- Work in small steps. Each commit is one logical change and its message references `#$ARGUMENTS`.
- Push after every commit (`git push -u origin HEAD` the first time).
- Stay inside the issue's scope. If something else needs doing, note it for a new issue instead of doing it here.

## 3. TEST
- Add or update unit tests that cover each acceptance criterion.
- For any UI change, drive the real app or extension with the browser tool and check the behaviour by hand.
- Run the full suite (`cd app && npm test`) and the linter (`npm run lint`, once it exists). Both must pass before moving on.

## 4. DEPLOY
- Open a PR with `gh pr create`. The title is the issue title; the body says `Closes #$ARGUMENTS`, summarises the change, ticks off each acceptance criterion with how it was tested, and lists anything left for later.
- Report the PR link and the CI status. Do not merge: Luca reviews, approves and merges, then runs `/clear` before the next issue.
