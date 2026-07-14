/* =========================================================================
   Store — שכבת הנתונים המשותפת (מקור אמת אחד)
   - כל שינוי אצל הבעלים או הזמנה של לקוח משתקפים בזמן אמת אצל כולם.
   - מצב מקומי:  localStorage + BroadcastChannel  (סנכרון בין כרטיסיות/משתמשים
     על אותו מכשיר, ללא הגדרות).
   - מצב מרוחק:  Firebase Firestore (סנכרון בין כל המכשירים) — נטען אוטומטית
     אם מולאו הפרטים ב-config.js.
   =========================================================================*/
window.UG = window.UG || {};
UG.Store = (function () {
  const KEY = "ug_barber_state_v1";
  const u = UG.util;

  let state = null;
  let backend = null;
  const subs = new Set();

  /* ---------- מצב ברירת מחדל ---------- */
  function defaultState() {
    const d = UG_CONFIG.defaults;
    const schedule = {};
    for (let i = 0; i < 7; i++) {
      let active = true, open = "09:00", close = "19:00";
      if (i === 5) { close = "14:00"; }          // שישי — עד הצהריים
      if (i === 6) { active = false; }            // שבת — סגור
      schedule[i] = { active, open, close };
    }
    return {
      version: 1,
      shop: {
        name: d.shopName, tagline: d.tagline, phone: d.phone, address: d.address,
        slotStep: d.slotStep, reminderMinutes: d.reminderMinutes,
      },
      schedule,
      services: [
        { id: u.uid(), name: "תספורת גבר", price: 60, durationMin: 30, icon: "✂️", active: true },
        { id: u.uid(), name: "זקן ועיצוב", price: 40, durationMin: 20, icon: "🧔", active: true },
      ],
      bookings: [],
      blocks: [],            // שעות שהבעלים סימן כלא-פנויות: "YYYY-MM-DD|HH:MM"
      updatedAt: Date.now(),
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* מיזוג בטוח מול ברירת המחדל (למקרה של גרסאות ישנות בזיכרון) */
  function normalize(s) {
    const base = defaultState();
    if (!s || typeof s !== "object") return base;
    s.shop = Object.assign({}, base.shop, s.shop);
    if (!s.schedule) s.schedule = base.schedule;
    for (let i = 0; i < 7; i++) s.schedule[i] = Object.assign({}, base.schedule[i], s.schedule[i]);
    if (!Array.isArray(s.services)) s.services = base.services;
    if (!Array.isArray(s.bookings)) s.bookings = [];
    if (!Array.isArray(s.blocks)) s.blocks = [];
    // מעבר למודל של מרווחי 45 דק׳ — נרמול ערכים ישנים
    if (![30, 45, 60].includes(Number(s.shop.slotStep))) s.shop.slotStep = 45;
    s.version = 1;
    return s;
  }

  /* =======================================================================
     Backend מקומי
     =======================================================================*/
  function LocalBackend() {
    let bc = null;
    try { bc = new BroadcastChannel("ug_barber"); } catch (e) {}
    return {
      mode: "local",
      read() {
        try {
          const raw = localStorage.getItem(KEY);
          return raw ? normalize(JSON.parse(raw)) : null;
        } catch (e) { return null; }
      },
      write(s) {
        s.updatedAt = Date.now();
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
        try { if (bc) bc.postMessage({ t: "sync", at: s.updatedAt }); } catch (e) {}
        return Promise.resolve();
      },
      onRemote(cb) {
        if (bc) bc.onmessage = () => cb();
        window.addEventListener("storage", (e) => { if (e.key === KEY) cb(); });
      },
    };
  }

  /* =======================================================================
     Backend של Firebase (compat SDK)
     =======================================================================*/
  function FirebaseBackend(db) {
    const ref = db.collection("shops").doc("main");
    return {
      mode: "cloud",
      _db: db, _ref: ref,
      read() {
        return ref.get().then((snap) => (snap.exists ? normalize(snap.data()) : null));
      },
      write(s) {
        s.updatedAt = Date.now();
        return ref.set(s);
      },
      onRemote(cb) {
        ref.onSnapshot((snap) => {
          if (snap.exists && !snap.metadata.hasPendingWrites) cb(snap.data());
        });
      },
      // הזמנה בטוחה מפני התנגשות (טרנזקציה אטומית)
      transactBooking(build) {
        return db.runTransaction((tx) =>
          tx.get(ref).then((snap) => {
            const cur = normalize(snap.exists ? snap.data() : defaultState());
            const res = build(cur);
            if (!res.ok) return res;
            cur.updatedAt = Date.now();
            tx.set(ref, cur);
            return res;
          })
        );
      },
    };
  }

  function loadFirebase() {
    return new Promise((resolve, reject) => {
      const cfg = UG_CONFIG.firebase;
      if (!cfg || !cfg.apiKey || !cfg.projectId) return reject("no-config");
      const load = (src) => new Promise((res, rej) => {
        const sc = document.createElement("script");
        sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc);
      });
      const V = "10.12.2";
      load(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`)
        .then(() => load(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore-compat.js`))
        .then(() => {
          firebase.initializeApp(cfg);
          const db = firebase.firestore();
          resolve(FirebaseBackend(db));
        })
        .catch(reject);
    });
  }

  /* =======================================================================
     API
     =======================================================================*/
  function emit() { subs.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

  function persist() { return backend.write(state).then(emit); }

  async function reloadFromRemote(remoteData) {
    if (remoteData) { state = normalize(remoteData); emit(); return; }
    const s = await backend.read();
    if (s) { state = s; emit(); }
  }

  async function bootBackend(b) {
    // מוודא שהחיבור באמת עובד (קריאה/כתיבה ראשונית)
    let s = await b.read();
    if (!s) { s = defaultState(); await b.write(s); }
    return s;
  }

  async function init() {
    // ניסיון חיבור לענן; אם נכשל (אין מסד נתונים / חוקי גישה / לא מקוון) — נופלים למצב מקומי
    try {
      const fb = await loadFirebase();
      const s = await bootBackend(fb);
      backend = fb; state = s;
    } catch (e) {
      if (UG_CONFIG.firebase && UG_CONFIG.firebase.apiKey) {
        console.warn("[UG] Firebase לא זמין — עוברים למצב מקומי.", e && e.message ? e.message : e);
      }
      backend = LocalBackend();
      state = await bootBackend(backend);
    }
    backend.onRemote((remote) => reloadFromRemote(remote));
    emit();
    return state;
  }

  function subscribe(fn) { subs.add(fn); if (state) fn(state); return () => subs.delete(fn); }
  function get() { return state; }

  /* ---------- מוטציות (בעלים) ---------- */
  function setDay(day, patch) {
    Object.assign(state.schedule[day], patch);
    return persist();
  }
  function saveShop(patch) { Object.assign(state.shop, patch); return persist(); }

  function upsertService(svc) {
    if (svc.id) {
      const i = state.services.findIndex((s) => s.id === svc.id);
      if (i >= 0) state.services[i] = Object.assign({}, state.services[i], svc);
    } else {
      svc.id = u.uid(); svc.active = true; state.services.push(svc);
    }
    return persist();
  }
  function removeService(id) {
    state.services = state.services.filter((s) => s.id !== id);
    return persist();
  }

  /* ---------- הזמנת תור (עם הגנה מפני כפילויות) ---------- */
  function buildBooking(cur, data) {
    const svc = cur.services.find((s) => s.id === data.serviceId);
    if (!svc) return { ok: false, reason: "השירות אינו קיים יותר" };
    const startMin = u.toMin(data.start);
    const endMin = startMin + svc.durationMin;
    // האם הבעלים חסם את השעה הזו?
    if ((cur.blocks || []).includes(data.date + "|" + data.start)) {
      return { ok: false, reason: "השעה כבר אינה זמינה" };
    }
    // בדיקת חפיפה מול תורים קיימים
    const clash = cur.bookings.some((b) => {
      if (b.status === "cancelled" || b.date !== data.date) return false;
      const bs = u.toMin(b.start), be = u.toMin(b.end);
      return startMin < be && endMin > bs;
    });
    if (clash) return { ok: false, reason: "התור נתפס הרגע — נסו שעה אחרת" };

    const booking = {
      id: u.uid(),
      serviceId: svc.id, serviceName: svc.name, price: svc.price, durationMin: svc.durationMin,
      date: data.date, start: data.start, end: u.toHHMM(endMin),
      userId: data.userId, userName: data.userName, phone: data.phone || "",
      status: "booked", createdAt: Date.now(),
    };
    cur.bookings.push(booking);
    return { ok: true, booking };
  }

  async function createBooking(data) {
    if (backend.transactBooking) {
      const res = await backend.transactBooking((cur) => buildBooking(cur, data));
      // Firestore יעדכן דרך onSnapshot; נטען מיידית ליתר ביטחון
      await reloadFromRemote();
      return res;
    }
    // מקומי: קרא מחדש את המצב העדכני לפני כתיבה כדי לצמצם התנגשויות
    const latest = backend.read();
    if (latest) state = latest;
    const res = buildBooking(state, data);
    if (res.ok) await persist();
    return res;
  }

  async function setBookingStatus(id, status) {
    if (backend.mode === "local") { const latest = backend.read(); if (latest) state = latest; }
    const b = state.bookings.find((x) => x.id === id);
    if (b) { b.status = status; await persist(); }
    return b;
  }

  // סימון/ביטול חסימה של שעה (בעלים)
  async function setBlock(dateKey, time, blocked) {
    if (backend.mode === "local") { const latest = backend.read(); if (latest) state = latest; }
    const key = dateKey + "|" + time;
    state.blocks = state.blocks || [];
    const has = state.blocks.includes(key);
    if (blocked && !has) state.blocks.push(key);
    else if (!blocked && has) state.blocks = state.blocks.filter((k) => k !== key);
    await persist();
  }

  return {
    init, subscribe, get,
    setDay, saveShop, upsertService, removeService,
    createBooking, setBookingStatus, setBlock,
    get mode() { return backend ? backend.mode : "local"; },
  };
})();
