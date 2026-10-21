// Date-text → YYYY-MM-DD parsing shared by the tracker reader (tracker-reader.js) and the
// job-page reader (job-page-reader.js). Exposed as window.WSO_Dates.
(function () {
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const monthIndex = (word) => MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)];

  // Dates → YYYY-MM-DD in LOCAL time. Handles Trackr's "31 Jan 27", WSO's "Aug 07" (no
  // year: the next occurrence from today), Workday's "October 16, 2026", ISO (incl. a
  // JSON-LD "2026-10-16T23:59:00"), and "31/01/2027" (UK day-first). Returns '' if
  // unparseable rather than guessing.
  function toISODate(text) {
    const s = (text || '').trim().toLowerCase().replace(/,/g, '');
    if (!s) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const out = (y, m, d) => {
      const date = new Date(y, m, d);
      if (date.getMonth() !== m || date.getDate() !== d) return '';
      return `${date.getFullYear()}-${pad(m + 1)}-${pad(d)}`;
    };
    const fullYear = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return out(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s))) return out(fullYear(m[3]), Number(m[2]) - 1, Number(m[1]));
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.? (\d{2,4})$/.exec(s))) {
      const mon = monthIndex(m[2]);
      return mon === undefined ? '' : out(fullYear(m[3]), mon, Number(m[1]));
    }
    if ((m = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/.exec(s))) {
      const mon = monthIndex(m[1]);
      if (mon === undefined) return '';
      if (m[3]) return out(fullYear(m[3]), mon, Number(m[2]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let year = today.getFullYear();
      if (new Date(year, mon, Number(m[2])) < today) year += 1;
      return out(year, mon, Number(m[2]));
    }
    return '';
  }

  window.WSO_Dates = { toISODate };
})();
