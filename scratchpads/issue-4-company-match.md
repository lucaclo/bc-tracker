# Issue #4: Company-name matching library (shared app + extension)

https://github.com/lucaclo/bc-tracker/issues/4

Stacked on `issue-3-contacts-store` (PR #16).

## Steps
1. `extension/lib/companyMatch.js` (new, UMD): `window.BC_CompanyMatch` in the extension,
   `module.exports` in Node. API: `normaliseCompany(name)`, `companyKey(name, userAliases)`,
   `sameCompany(a, b, userAliases)`, `isKnownCompany(name, userAliases)`.
   - normalise: NFKD + strip accents, lowercase, `&`→`and`, dots/apostrophes dropped, other
     punctuation → space, leading "the", trailing legal suffixes dropped (LLP, Ltd, Limited, plc,
     Inc, Group, & Co, Holdings, LLC, Corp…) but never down to nothing.
   - key = normalised name with spaces removed (`J. P. Morgan` = `JPMorgan`), then mapped through
     user aliases, then the built-in alias table, to a canonical key.
   - exact or alias only: no substring or edit-distance matching.
2. `app/lib/contacts.js`: replace the placeholder `companyKey` with the shared one.
3. `app/test/company-match.test.js`: every alias group, user aliases, false positives
   (Citi/Citizens Bank, Goldman Sachs/Goldman Sachs Asset Management stays separate, MS/Microsoft…).

## Testing each acceptance criterion
- normalisation: table test of raw → normalised.
- built-in aliases: one assertion per group, every variant → same key.
- user aliases: test passing `{ 'GS AM': 'Goldman Sachs' }`.
- no weak matches: false-positive table.
- unit tests cover every group + false positives: the test file itself.
