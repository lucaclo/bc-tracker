# Issue #2: CI: GitHub Actions `ci` job (tests + lint)

https://github.com/lucaclo/bc-tracker/issues/2

## Steps
1. Commit the `/process-issue` command (`.claude/commands/process-issue.md`) and this plan.
2. Add ESLint 9 + `globals` as devDependencies in `app/`; add `app/eslint.config.js` (flat config,
   `eslint:recommended`) with three file groups:
   - browser + `chrome` globals: `../extension/**/*.js`, `public/**/*.js`
   - node (CommonJS): `server.js`, `lib/**/*.js`, `test/**/*.js`
   - shell scripts are not linted.
   Add `"lint": "eslint . ../extension"` to `app/package.json`.
3. Run the linter, fix real errors, disable only rules that clash with the codebase's deliberate
   patterns (e.g. extension files that share globals through script load order) and say why in the config.
4. Add `.github/workflows/ci.yml`: one job `ci`, `ubuntu-latest`, Node 22 via `actions/setup-node`
   with `cache: npm` and `cache-dependency-path: app/package-lock.json`; `npm ci`, `npm run lint`,
   `npm test`, all in `app/`. Triggers: `push` and `pull_request`.

## Files
- `.claude/commands/process-issue.md` (new)
- `app/package.json`, `app/package-lock.json`
- `app/eslint.config.js` (new)
- lint fixes in `app/` and `extension/` as needed
- `.github/workflows/ci.yml` (new)

## Testing each acceptance criterion
- `npm test` on push/PR in job `ci`: the PR shows a `ci` check that ran the suite (check the run log).
- ESLint over `app/` + `extension/` fails on errors: `npm run lint` passes locally; temporarily add an
  undefined variable locally and confirm it exits non-zero (not committed).
- Node 22 + npm cache: visible in the workflow run's setup-node step.
- `ci` check visible and requirable: shown on the PR; branch protection is Luca's step after merge.
