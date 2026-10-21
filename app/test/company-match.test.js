// Shared company matcher (extension/lib/companyMatch.js, issue #4). The app require()s the
// same file the extension loads, so these cover both. Exact or alias only, never a guess.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseCompany, companyKey, sameCompany, isKnownAlias, BUILTIN_ALIASES } = require('../../extension/lib/companyMatch');

test('normalises case, punctuation, & and legal suffixes', () => {
  const cases = {
    'J.P. Morgan & Co.': 'jp morgan',
    'Rothschild & Co': 'rothschild',
    'HSBC Holdings plc': 'hsbc',
    'UBS Group AG': 'ubs',
    'Brown Advisory Limited': 'brown advisory',
    'Evercore Inc.': 'evercore',
    'Clifford Chance LLP': 'clifford chance',
    'Morgan Stanley & Co. International plc': 'morgan stanley',
    'The Carlyle Group': 'carlyle',
    'Société Générale': 'societe generale',
    '  Lazard   Ltd ': 'lazard',
    'Group': 'group',
    '': ''
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(normaliseCompany(raw), want, raw);
});

test('every built-in alias group resolves to one key', () => {
  const groups = [
    ['J.P. Morgan', 'JPMorgan', 'JPM', 'JPMorgan Chase', 'JPMorgan Chase & Co.', 'J. P. Morgan', 'Chase'],
    ['Goldman Sachs', 'GS', 'Goldman Sachs International', 'The Goldman Sachs Group, Inc.'],
    ['BofA', 'Bank of America', 'Merrill Lynch', 'BofA Securities', 'Bank of America Merrill Lynch'],
    ['Citi', 'Citigroup', 'Citigroup Inc.', 'Citibank'],
    ['Morgan Stanley', 'MS', 'Morgan Stanley & Co. International plc'],
    ['Barclays', 'Barclays PLC', 'Barclays Investment Bank'],
    ['UBS', 'UBS Group AG', 'UBS Investment Bank'],
    ['Deutsche Bank', 'DB', 'Deutsche Bank AG'],
    ['HSBC', 'HSBC Holdings plc', 'HSBC Global Banking and Markets'],
    ['Evercore', 'Evercore Inc.', 'Evercore Partners'],
    ['PJT', 'PJT Partners', 'PJT Partners Inc.'],
    ['Lazard', 'Lazard Ltd', 'Lazard Frères'],
    ['Rothschild & Co', 'Rothschild', 'N M Rothschild']
  ];
  assert.equal(groups.length, Object.keys(BUILTIN_ALIASES).length);
  for (const names of groups) {
    const keys = new Set(names.map((n) => companyKey(n)));
    assert.equal(keys.size, 1, `${names.join(' / ')} → ${[...keys].join(', ')}`);
    assert.ok(names.every((n) => isKnownAlias(n)));
  }
  assert.notEqual(companyKey('JPMorgan'), companyKey('Goldman Sachs'));
});

test('user aliases passed at call time', () => {
  const aliases = { 'GS Asset Mgmt': 'Goldman Sachs', 'Old Firm Name': 'Brand New Capital' };
  assert.ok(sameCompany('GS Asset Mgmt', 'Goldman Sachs', aliases));
  assert.ok(sameCompany('old firm name ltd', 'Brand New Capital', aliases));
  assert.ok(!sameCompany('GS Asset Mgmt', 'Goldman Sachs'));
  assert.ok(isKnownAlias('Old Firm Name', aliases));
  assert.ok(!isKnownAlias('Old Firm Name'));
});

test('no match on a substring or weak resemblance', () => {
  const different = [
    ['Citi', 'Citizens Bank'],
    ['Citi', 'Citadel'],
    ['Goldman Sachs', 'Goldman Sachs Asset Management'],
    ['Morgan Stanley', 'JP Morgan'],
    ['MS', 'Microsoft'],
    ['UBS', 'UBS Wealth Partners Fund'],
    ['Barclays', 'Barclay Investments'],
    ['Lazard', 'Lazard Asset Management'],
    ['Evercore', 'Evercoal'],
    ['DB', 'DBS Bank'],
    ['', ''],
    ['Acme', '']
  ];
  for (const [a, b] of different) assert.ok(!sameCompany(a, b), `${a} vs ${b}`);
  assert.ok(!isKnownAlias('Blackstone'));
  assert.ok(sameCompany('Blackstone Inc.', 'blackstone'));
});
