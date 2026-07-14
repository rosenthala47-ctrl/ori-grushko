/* =========================================================================
   Notify — הרשאות התראות פוש + תזכורת שעה לפני התור
   =========================================================================*/
window.UG = window.UG || {};
UG.Notify = (function () {
  const u = UG.util;
  const FIRED_KEY = "ug_reminders_fired";
  let swReg = null;
  const timers = new Map();

  function supported() { return "Notification" in window; }
  function permission() { return supported() ? Notification.permission : "unsupported"; }

  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch(() => {});
    }
  }

  // פותח את חלון ההרשאה של הדפדפן לשליחת התראות
  async function requestPermission() {
    if (!supported()) return "unsupported";
    try {
      const res = await Notification.requestPermission();
      return res;
    } catch (e) { return "denied"; }
  }

  function show(title, body, opts) {
    opts = opts || {};
    if (permission() !== "granted") return false;
    const options = {
      body,
      icon: "assets/img/icon-192.png",
      badge: "assets/img/icon-192.png",
      dir: "rtl", lang: "he",
      tag: opts.tag, renotify: true, data: opts.data || {},
      vibrate: [80, 40, 80],
    };
    try {
      if (swReg && swReg.showNotification) swReg.showNotification(title, options);
      else new Notification(title, options);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- ניהול "כבר נשלח" ---------- */
  function firedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function markFired(id) {
    const s = firedSet(); s.add(id);
    try { localStorage.setItem(FIRED_KEY, JSON.stringify([...s].slice(-100))); } catch (e) {}
  }

  /* ---------- תזמון תזכורות עבור התורים של הלקוח ---------- */
  function clearTimers() { timers.forEach((t) => clearTimeout(t)); timers.clear(); }

  function scheduleReminders(bookings, userId, shop) {
    clearTimers();
    if (permission() !== "granted") return;
    const reminderMin = (shop && shop.reminderMinutes) || 60;
    const fired = firedSet();
    const now = Date.now();

    bookings
      .filter((b) => b.userId === userId && b.status !== "cancelled")
      .forEach((b) => {
        const apptTs = u.dateTime(b.date, b.start).getTime();
        if (apptTs <= now) return;                          // תור שכבר עבר
        const remindTs = apptTs - reminderMin * 60000;
        const fireId = b.id + ":" + b.start;
        if (fired.has(fireId)) return;
        // חלון תזמון: מקסימום ~24 שעות קדימה (מגבלת setTimeout/סבירות)
        let delay = remindTs - now;
        if (delay < 0) delay = apptTs - now > 2 * 60000 ? 1500 : -1; // עבר זמן התזכורת אך התור עוד רחוק → הזכר מיד
        if (delay < 0 || delay > 24 * 3600 * 1000) return;

        const label = u.relativeDay(b.date);
        const t = setTimeout(() => {
          show(
            "⏰ תזכורת לתספורת",
            `${b.serviceName} ${label} בשעה ${b.start} · ${shop.name}`,
            { tag: "reminder-" + b.id }
          );
          markFired(fireId);
        }, delay);
        timers.set(b.id, t);
      });
  }

  return { supported, permission, requestPermission, show, scheduleReminders, registerSW };
})();
