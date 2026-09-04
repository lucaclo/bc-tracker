(function () {
  window.WSO_SiteMappers = window.WSO_SiteMappers || {};

  window.WSO_SiteMappers.greenhouse = {
    test() {
      return /greenhouse\.io$/.test(location.hostname) || /boards\.greenhouse\.io$/.test(location.hostname);
    },
    run(profile) {
      const FM = window.WSO_FieldMap;
      const textMap = [
        ['#first_name', 'legalFirstName'],
        ['#last_name', 'legalLastName'],
        ['#email', 'email'],
        ['#phone', 'phoneNumber']
      ];
      for (const [selector, key] of textMap) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const value = FM.resolveProfileValue(profile, key);
        if (value && FM.fillTextLike(el, value)) FM.markFilled(el);
      }

      const resume = document.querySelector('#resume, input[name="resume"], input[id*="resume"][type="file"]');
      if (resume) FM.markFlagged(resume, 'Résumé upload (Greenhouse) — click to attach your CV');

      const coverLetter = document.querySelector(
        '#cover_letter, input[name="cover_letter"], input[id*="cover_letter"][type="file"]'
      );
      if (coverLetter) FM.markFlagged(coverLetter, 'Cover letter upload (Greenhouse)');
    }
  };
})();
