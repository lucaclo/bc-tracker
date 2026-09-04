(function () {
  window.WSO_SiteMappers = window.WSO_SiteMappers || {};

  window.WSO_SiteMappers.workday = {
    test() {
      return /myworkday(jobs)?\.com$/.test(location.hostname) || location.hostname.includes('myworkday');
    },
    async run(profile) {
      const FM = window.WSO_FieldMap;
      const CF = window.WSO_ComboboxFill;
      // Workday's actual markup varies a lot by company/tenant — some use
      // data-automation-id, others (confirmed live on a real Workday careers site) use
      // plain name/id attributes instead (name="addressLine1", id="address--city", etc,
      // with no data-automation-id at all). Try several selector styles per field; the
      // generic label-matching pass below still runs as a further fallback for whatever
      // this doesn't catch.
      const textMap = [
        ['input[data-automation-id="legalNameSection_firstName"], input[name="legalName--firstName"]', 'legalFirstName'],
        ['input[data-automation-id="legalNameSection_lastName"], input[name="legalName--lastName"]', 'legalLastName'],
        ['input[data-automation-id="preferredNameSection_firstName"], input[name="preferredName--firstName"]', 'preferredName'],
        ['input[data-automation-id="email"], input[name="email"]', 'email'],
        ['input[data-automation-id="phone-number"], input[name="phoneNumber"]', 'phoneNumber'],
        ['input[data-automation-id="addressSection_addressLine1"], input[name="addressLine1"]', 'addressLine1'],
        ['input[data-automation-id="addressSection_addressLine2"], input[name="addressLine2"]', 'addressLine2'],
        ['input[data-automation-id="addressSection_city"], input[name="city"]', 'city'],
        ['input[data-automation-id="addressSection_postalCode"], input[name="postalCode"]', 'postcode']
      ];
      for (const [selector, key] of textMap) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const value = FM.resolveProfileValue(profile, key);
        if (value && FM.fillTextLike(el, value)) FM.markFilled(el);
      }

      // Workday's dropdowns (country, work authorization, visa/legal questions, etc) are
      // custom widgets — confirmed live: a <button aria-haspopup="listbox"> with an
      // obfuscated class name and no data-automation-id, not a native <select>. That ARIA
      // attribute is a stable accessibility hook (unlike the class name), so it reliably
      // catches every one of these across any Workday tenant, not just the few field types
      // guessed at before. Forcing a raw .value into them is unsafe (leaves Workday's
      // internal state inconsistent with what's displayed) — but clicking the real trigger,
      // then the real rendered option, is exactly what a human does and keeps that state
      // consistent. WSO_ComboboxFill does that, only ever clicking a 'high'/'medium'
      // confidence match and verifying the click stuck; anything else still falls back to
      // a flag, same as before.
      const dropdownTriggers = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]'));
      for (const el of dropdownTriggers) {
        if (el.dataset.wsoFilled === '1' || el.classList.contains('wso-flagged')) continue;
        const stillUnset = !el.textContent.trim() || /^select one$/i.test(el.textContent.trim());
        if (!stillUnset) continue; // already has a real selection — nothing to do

        const label = FM.getFieldLabelText(el);
        if (FM.isEEOQuestion(label) || FM.isThirdPartyContext(label) || FM.isNeverInferField(label)) {
          FM.markFlagged(el, label.trim());
          continue;
        }
        const canonical = FM.matchCanonicalField(label);
        const value = canonical ? FM.resolveProfileValue(profile, canonical) : '';

        if (value) {
          // A misbehaving dropdown must not stop the remaining triggers (or the résumé
          // flag below) from being processed — fall back to a plain flag on this one.
          try {
            const result = await CF.fill(el, value, FM);
            if (result.status === 'filled') {
              FM.markFilled(
                el,
                result.tier,
                result.tier === 'medium' ? `${(label || 'Dropdown').trim()} — auto-matched "${result.matchedText}", worth checking` : undefined
              );
              continue;
            }
            const suffix = result.candidates && result.candidates.length ? ` — closest options: ${result.candidates.join(', ')}` : '';
            FM.markFlagged(el, `${(label || 'Dropdown').trim()} — Workday dropdown${suffix || ', please select manually'}`);
          } catch (e) {
            FM.markFlagged(el, `${(label || 'Dropdown').trim()} — Workday dropdown, please select manually`);
          }
          continue;
        }

        FM.markFlagged(el, `${(label || 'Dropdown').trim()} — Workday dropdown, please select manually`);
      }

      const resumeInput = document.querySelector(
        '[data-automation-id="file-upload-drop-zone"] input[type="file"], input[data-automation-id="file-upload-input-ref"]'
      );
      if (resumeInput) FM.markFlagged(resumeInput, 'Résumé upload (Workday) — click to attach your CV');
    }
  };
})();
