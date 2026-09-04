// Real-interaction engine for custom ARIA dropdown/combobox widgets (Workday's
// button[aria-haspopup="listbox"] pickers, react-select-style searchable comboboxes on
// Greenhouse/Lever/elsewhere, etc). Detection is ARIA-pattern based, not site-specific
// selectors — same "match the stable accessibility hook, not the class name" philosophy
// already used in siteMappers/workday.js and content/tracker-reader.js.
//
// Why real interaction instead of forcing a value: these widgets keep internal state
// (open/closed, selected index, filter text) that a raw .value assignment can't touch,
// leaving the framework's own model out of sync with what's on screen — the exact
// failure mode the original Workday mapper avoided by flagging instead. Clicking the
// real trigger, typing into the real filter input, and clicking the real option element
// drives the same code path a human does, so the widget's own state stays consistent.
// Every step is verified and every path — match, no-match, or failure — leaves the
// widget closed and either genuinely filled or cleanly flagged. Never guesses: only
// 'high'/'medium' tier matches (see fieldMap.js matchOptionTier) are ever clicked in;
// a 'weak'-only match is left for the user, with the candidates handed back so autofill.js
// can put them in the flag reason.

(function () {
  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(conditionFn, { timeout = 1200, interval = 60 } = {}) {
    const start = Date.now();
    for (;;) {
      const result = conditionFn();
      if (result) return result;
      if (Date.now() - start >= timeout) return false;
      await delay(interval);
    }
  }

  function fireEvent(el, type, opts) {
    let evt;
    try {
      if (type.startsWith('pointer') && window.PointerEvent) {
        evt = new PointerEvent(type, { bubbles: true, cancelable: true, view: window, ...opts });
      } else if (type === 'click' || type.startsWith('mouse')) {
        evt = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...opts });
      } else if (type === 'keydown' || type === 'keyup') {
        evt = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...opts });
      } else {
        evt = new Event(type, { bubbles: true, cancelable: true });
      }
    } catch (e) {
      evt = new Event(type, { bubbles: true, cancelable: true });
    }
    // A dispatched (not just .click()-called) 'click' event still runs the target's
    // native default action — including form submission, if the trigger happens to be a
    // bare <button> inside a <form> (which defaults to type="submit"). Real ATS widgets
    // normally guard their own dropdown triggers against this themselves, but this must
    // never depend on that: never-auto-submit is non-negotiable, so every synthetic click
    // this engine dispatches has its native default action suppressed unconditionally.
    // This does NOT stop the widget's own onClick-driven open/select logic — listeners
    // still run regardless of preventDefault(); only the browser's built-in action
    // (submit/navigate/toggle) is suppressed.
    if (type === 'click' && evt.cancelable) evt.preventDefault();
    el.dispatchEvent(evt);
  }

  function openTrigger(el) {
    el.focus?.({ preventScroll: true });
    fireEvent(el, 'pointerdown');
    fireEvent(el, 'mousedown');
    fireEvent(el, 'mouseup');
    fireEvent(el, 'click');
  }

  function selectOption(el) {
    fireEvent(el, 'pointerdown');
    fireEvent(el, 'mousedown');
    fireEvent(el, 'mouseup');
    fireEvent(el, 'click');
  }

  function closePopup(trigger) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : trigger;
    fireEvent(target, 'keydown', { key: 'Escape', code: 'Escape' });
    target.blur?.();
  }

  function isCustomDropdownTrigger(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('role') === 'combobox') return true;
    const haspopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    if (haspopup === 'listbox') return true;
    if (el.tagName === 'INPUT') {
      const auto = (el.getAttribute('aria-autocomplete') || '').toLowerCase();
      if (auto === 'list' || auto === 'both') return true;
    }
    return false;
  }

  function getListboxCandidates() {
    return Array.from(document.querySelectorAll('[role="listbox"]'));
  }

  function getOptionElements(listbox) {
    const opts = Array.from(listbox.querySelectorAll('[role="option"]')).filter(isVisible);
    if (opts.length) return opts;
    // Fallback for widgets that render plain rows without role="option".
    return Array.from(listbox.querySelectorAll('li, [class*="option" i]')).filter(isVisible);
  }

  async function resolveListbox(trigger, beforeSet) {
    const controlsId = trigger.getAttribute('aria-controls');
    const byControls = () => {
      if (!controlsId) return null;
      const el = document.getElementById(controlsId);
      return el && getOptionElements(el).length ? el : null;
    };
    const byDiff = () => {
      const now = getListboxCandidates();
      const added = now.find((lb) => !beforeSet.has(lb) && getOptionElements(lb).length);
      if (added) return added;
      return now.find((lb) => isVisible(lb) && getOptionElements(lb).length) || null;
    };
    return waitFor(() => byControls() || byDiff(), { timeout: 1500, interval: 60 });
  }

  // Best-effort: find the actual text input a searchable combobox types into. If the
  // trigger itself is the input (react-select/downshift pattern), use it directly.
  // Otherwise look for a visible text input inside the trigger's immediate widget
  // wrapper. Returning null just means matching runs against the full option list
  // instead of a filtered one — still correct, just less precise on very long lists.
  function findTypeableInput(trigger) {
    if (trigger.tagName === 'INPUT') return trigger;
    const container =
      trigger.closest('[class*="select" i], [class*="combobox" i], [role="group"]') || trigger.parentElement;
    const input = container && container.querySelector('input[type="text"], input:not([type])');
    return input && isVisible(input) ? input : null;
  }

  function isSelectionReflected(FM, trigger, optionEl) {
    const wanted = FM.normalizeForMatch(optionEl.textContent);
    if (!wanted) return false;
    if (optionEl.getAttribute('aria-selected') === 'true') return true;
    if (trigger.tagName === 'INPUT') return FM.normalizeForMatch(trigger.value).includes(wanted);
    return FM.normalizeForMatch(trigger.textContent).includes(wanted);
  }

  // Opens the widget, optionally filters it, matches the target value against the
  // rendered options, and — only for 'high'/'medium' confidence matches — clicks the
  // option and verifies the selection stuck. Returns:
  //   { status: 'filled', tier, matchedText }
  //   { status: 'flag', candidates?: string[] }   (no match, weak-only match, or the
  //                                                 widget didn't open / verify)
  //   { status: 'skip' }                           (no value to fill)
  async function fill(trigger, value, FM) {
    if (!value) return { status: 'skip' };

    const before = new Set(getListboxCandidates());
    openTrigger(trigger);
    const listbox = await resolveListbox(trigger, before);
    if (!listbox) {
      closePopup(trigger);
      return { status: 'flag' };
    }

    const typeable = findTypeableInput(trigger);
    if (typeable) {
      FM.setNativeValue(typeable, value);
      await waitFor(() => getOptionElements(listbox).length, { timeout: 1800, interval: 80 });
    }

    const options = getOptionElements(listbox);
    if (!options.length) {
      closePopup(trigger);
      return { status: 'flag' };
    }

    const items = options.map((el) => ({ ref: el, texts: [el.textContent || ''] }));
    const match = FM.matchOptionTier(items, value);

    if (!match || match.tier === 'weak') {
      const candidates = match ? match.candidates.map((c) => (c.texts[0] || '').trim()).filter(Boolean) : [];
      closePopup(trigger);
      return { status: 'flag', candidates };
    }

    selectOption(match.item.ref);
    await delay(120);

    const verified = await waitFor(() => isSelectionReflected(FM, trigger, match.item.ref), {
      timeout: 900,
      interval: 60
    });
    if (!verified) {
      closePopup(trigger);
      return { status: 'flag', candidates: [(match.item.texts[0] || '').trim()].filter(Boolean) };
    }

    return { status: 'filled', tier: match.tier, matchedText: (match.item.texts[0] || '').trim() };
  }

  // Multi-select variant for "add skills" style widgets: repeats open→filter→match→click
  // once per value (capped), never guessing on any single value any more than fill()
  // does. Always leaves the widget closed. Returns which values landed vs didn't, so a
  // partial success is never silently reported as complete.
  async function fillMulti(trigger, values, FM, opts = {}) {
    const max = opts.max || 15;
    const subset = (values || []).filter(Boolean).slice(0, max);
    const filled = [];
    const unfilled = [];

    let before = new Set(getListboxCandidates());
    openTrigger(trigger);
    let listbox = await resolveListbox(trigger, before);

    for (const value of subset) {
      if (!listbox || !isVisible(listbox)) {
        before = new Set(getListboxCandidates());
        openTrigger(trigger);
        listbox = await resolveListbox(trigger, before);
      }
      if (!listbox) {
        unfilled.push(value);
        continue;
      }

      const typeable = findTypeableInput(trigger);
      if (typeable) {
        FM.setNativeValue(typeable, value);
        await waitFor(() => getOptionElements(listbox).length, { timeout: 1800, interval: 80 });
      }

      let options = getOptionElements(listbox);
      if (!options.length && typeable) {
        // A widget that re-renders (rather than mutates in place) can swap the listbox
        // for a new DOM node between selections without the old one ever becoming
        // invisible — isVisible() alone won't catch that staleness. One fresh
        // open+resolve here recovers from it instead of quietly giving up on every
        // remaining value in the list.
        before = new Set(getListboxCandidates());
        openTrigger(trigger);
        listbox = await resolveListbox(trigger, before);
        if (listbox) {
          FM.setNativeValue(typeable, value);
          await waitFor(() => getOptionElements(listbox).length, { timeout: 1800, interval: 80 });
          options = getOptionElements(listbox);
        }
      }
      if (!listbox || !options.length) {
        unfilled.push(value);
        continue;
      }

      const items = options.map((el) => ({ ref: el, texts: [el.textContent || ''] }));
      const match = FM.matchOptionTier(items, value);

      if (!match || match.tier === 'weak') {
        unfilled.push(value);
        continue;
      }

      selectOption(match.item.ref);
      await delay(150);
      filled.push(value);
      if (typeable) FM.setNativeValue(typeable, '');
    }

    closePopup(trigger);
    return { filled, unfilled };
  }

  window.WSO_ComboboxFill = {
    isCustomDropdownTrigger,
    fill,
    fillMulti
  };
})();
