/* עזרי תאריך/שעה וכלים כלליים */
window.UG = window.UG || {};
UG.util = (function () {
  const DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const DOW_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  const MON = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];

  const pad = (n) => String(n).padStart(2, "0");

  // מפתח תאריך מקומי YYYY-MM-DD (ללא הסטת אזור זמן)
  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function parseKey(key) {
    const [y, m, dd] = key.split("-").map(Number);
    return new Date(y, m - 1, dd);
  }
  // "HH:MM" -> דקות מתחילת היום
  function toMin(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function toHHMM(min) {
    return pad(Math.floor(min / 60)) + ":" + pad(min % 60);
  }
  function fmtDuration(min) {
    if (min < 60) return min + " דק׳";
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}:${pad(m)} שע׳` : `${h} שע׳`;
  }
  function fmtPrice(p) {
    return "₪" + Number(p || 0).toLocaleString("he-IL");
  }
  // תאריך+שעה -> אובייקט Date מקומי
  function dateTime(key, hhmm) {
    const d = parseKey(key);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(toMin(hhmm));
    return d;
  }
  function isSameDay(a, b) { return dateKey(a) === dateKey(b); }

  // תיאור יחסי: "היום" / "מחר" / "יום ג׳"
  function relativeDay(key) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = parseKey(key);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return "היום";
    if (diff === 1) return "מחר";
    return "יום " + DOW_SHORT[d.getDay()];
  }
  function longDate(key) {
    const d = parseKey(key);
    return `יום ${DOW[d.getDay()]}, ${d.getDate()} ב${MON[d.getMonth()]}`;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return {
    DOW, DOW_SHORT, MON, pad, dateKey, parseKey, toMin, toHHMM,
    fmtDuration, fmtPrice, dateTime, isSameDay, relativeDay, longDate, uid, escapeHtml,
  };
})();
