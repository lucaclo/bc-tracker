(function () {
  window.WSO_SiteMappers = window.WSO_SiteMappers || {};

  window.WSO_SiteMappers.lever = {
    test() {
      return /jobs\.lever\.co$/.test(location.hostname) || /lever\.co$/.test(location.hostname);
    },
    run(profile) {
      const FM = window.WSO_FieldMap;
      const textMap = [
        ['input[name="name"]', 'fullName'],
        ['input[name="email"]', 'email'],
        ['input[name="phone"]', 'phoneNumber'],
        ['input[name="urls[LinkedIn]"]', 'linkedinUrl'],
        ['input[name="urls[GitHub]"]', 'portfolioUrl'],
        ['input[name="urls[Portfolio]"]', 'portfolioUrl']
      ];
      for (const [selector, key] of textMap) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const value = FM.resolveProfileValue(profile, key);
        if (value && FM.fillTextLike(el, value)) FM.markFilled(el);
      }

      const resume = document.querySelector(
        'input[name="resume"][type="file"], .application-file-upload-wrapper input[type="file"]'
      );
      if (resume) FM.markFlagged(resume, 'Résumé upload (Lever) — click to attach your CV');
    }
  };
})();
