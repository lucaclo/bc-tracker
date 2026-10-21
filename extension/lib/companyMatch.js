// Company-name matching shared by the app (require()) and the extension
// (window.BC_CompanyMatch). Decides whether two company strings are the same firm, by exact
// normalised name or a known alias only. A weak or partial resemblance is NOT a match:
// "Citi" never matches "Citizens Bank". Same flag-over-guess rule as the autofill.
/* global module */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BC_CompanyMatch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Dropped from the END of a name only, repeatedly ("Rothschild & Co Holdings Ltd").
  const LEGAL_SUFFIXES = [
    'and co', 'and company', 'co', 'company',
    'llp', 'lp', 'llc', 'ltd', 'limited', 'plc', 'inc', 'incorporated',
    'corp', 'corporation', 'group', 'holdings', 'holding', 'international',
    'sa', 'ag', 'se', 'nv', 'bv', 'gmbh', 'spa', 'srl'
  ];

  // Canonical key → every way people write that firm (written as normalised names).
  const BUILTIN_ALIASES = {
    jpmorgan: ['jp morgan', 'jpm', 'jpmorgan chase', 'jp morgan chase', 'chase', 'jpmc', 'jp morgan securities'],
    goldmansachs: ['goldman sachs', 'gs', 'goldman', 'goldman sachs international'],
    bankofamerica: ['bank of america', 'bofa', 'boa', 'bofa securities', 'merrill lynch', 'merrill',
      'bank of america merrill lynch', 'baml', 'bofaml'],
    citi: ['citi', 'citigroup', 'citibank', 'citigroup global markets'],
    morganstanley: ['morgan stanley', 'ms'],
    barclays: ['barclays', 'barclays capital', 'barclays investment bank', 'barclays bank'],
    ubs: ['ubs', 'ubs investment bank'],
    deutschebank: ['deutsche bank', 'db', 'deutsche'],
    hsbc: ['hsbc', 'hsbc bank', 'hsbc global banking and markets'],
    evercore: ['evercore', 'evercore partners'],
    pjt: ['pjt', 'pjt partners'],
    lazard: ['lazard', 'lazard freres'],
    rothschild: ['rothschild', 'rothschild and co', 'n m rothschild', 'nm rothschild']
  };

  // "J.P. Morgan & Co." → "jp morgan". Never strips a name down to nothing.
  function normaliseCompany(name) {
    let s = String(name || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[.'’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/^the /, '');
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of LEGAL_SUFFIXES) {
        if (s.endsWith(' ' + suffix)) {
          s = s.slice(0, -suffix.length - 1).trim();
          changed = true;
        }
      }
    }
    return s;
  }

  const compact = (s) => s.replace(/ /g, '');

  const BUILTIN_LOOKUP = {};
  for (const [key, variants] of Object.entries(BUILTIN_ALIASES)) {
    BUILTIN_LOOKUP[key] = key;
    for (const v of variants) BUILTIN_LOOKUP[compact(normaliseCompany(v))] = key;
  }

  function builtinKey(name) {
    const c = compact(normaliseCompany(name));
    return BUILTIN_LOOKUP[c] || c;
  }

  // userAliases: { "raw name as captured": "company it really is" }, saved in the profile when
  // the user assigns an unrecognised contact to a firm.
  function userLookup(userAliases) {
    const out = {};
    for (const [raw, target] of Object.entries(userAliases || {})) {
      const from = compact(normaliseCompany(raw));
      if (from && target) out[from] = builtinKey(target);
    }
    return out;
  }

  function companyKey(name, userAliases) {
    const c = compact(normaliseCompany(name));
    if (!c) return '';
    const user = userLookup(userAliases);
    return user[c] || BUILTIN_LOOKUP[c] || c;
  }

  function sameCompany(a, b, userAliases) {
    const ka = companyKey(a, userAliases);
    return !!ka && ka === companyKey(b, userAliases);
  }

  // True when the name is in the built-in table or the user's own aliases.
  function isKnownAlias(name, userAliases) {
    const c = compact(normaliseCompany(name));
    return !!c && (c in BUILTIN_LOOKUP || c in userLookup(userAliases));
  }

  return { normaliseCompany, companyKey, sameCompany, isKnownAlias, BUILTIN_ALIASES };
});
