/* =========================================================================
   App — ניהול מסכים, תצוגה וחיווט אירועים
   =========================================================================*/
(function () {
  const u = UG.util;
  const Store = UG.Store;
  const Notify = UG.Notify;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = u.escapeHtml;

  /* ---------- מצב תצוגה מקומי (לא נשמר בשרת) ---------- */
  const view = {
    route: localStorage.getItem("ug_route") || "role", // role | client | owner
    clientTab: "book",   // book | mine
    ownerTab: "cal",     // cal | services | bookings | settings
    selService: null,
    selDate: null,
    selSlot: null,
  };
  let ownerSeen = null;     // Set של מזהי תורים שהבעלים כבר ראה (זיהוי תור חדש)
  let identity = loadIdentity();

  function loadIdentity() {
    try {
      const i = JSON.parse(localStorage.getItem("ug_identity") || "null");
      if (i && i.userId) return i;
    } catch (e) {}
    const fresh = { userId: u.uid(), name: "", phone: "" };
    localStorage.setItem("ug_identity", JSON.stringify(fresh));
    return fresh;
  }
  function saveIdentity() { localStorage.setItem("ug_identity", JSON.stringify(identity)); }

  /* =======================================================================
     טוסט ומודאל
     =======================================================================*/
  function toast(msg, kind, ico) {
    const wrap = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.innerHTML = `<span class="t-ico">${ico || "✅"}</span><span>${esc(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 3200);
  }
  function openModal(html) {
    $("#modal").innerHTML = `<div class="m-handle"></div>` + html;
    $("#modalBack").classList.add("open");
  }
  function closeModal() { $("#modalBack").classList.remove("open"); }

  /* =======================================================================
     ראוטינג
     =======================================================================*/
  function go(route) {
    view.route = route;
    localStorage.setItem("ug_route", route);
    if (route === "owner" && !ownerSeen) {
      const st = Store.get();
      ownerSeen = new Set(st.bookings.map((b) => b.id)); // בסיס — לא להתריע על קיימים
    }
    render();
  }

  /* אל תבצע רינדור-מלא בזמן שהמשתמש מקליד בשדה בתוך המסך */
  function isEditingRoot() {
    const a = document.activeElement;
    return a && $("#root") && $("#root").contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName);
  }

  /* =======================================================================
     חישוב זמינות תורים
     =======================================================================*/
  function daySlots(dateKey, service) {
    const st = Store.get();
    const dow = u.parseKey(dateKey).getDay();
    const sched = st.schedule[dow];
    if (!sched || !sched.active) return [];
    const open = u.toMin(sched.open), close = u.toMin(sched.close);
    const step = st.shop.slotStep || 15;
    const dur = service.durationMin;
    const now = new Date();
    const isToday = u.isSameDay(u.parseKey(dateKey), now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dayBookings = st.bookings.filter((b) => b.status !== "cancelled" && b.date === dateKey);
    const slots = [];
    for (let t = open; t + dur <= close; t += step) {
      if (isToday && t <= nowMin) continue; // דלג על שעות שכבר עברו
      const end = t + dur;
      const taken = dayBookings.some((b) => {
        const bs = u.toMin(b.start), be = u.toMin(b.end);
        return t < be && end > bs;
      });
      slots.push({ start: u.toHHMM(t), taken });
    }
    return slots;
  }

  function nextDays(n) {
    const arr = [];
    const d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const dd = new Date(d); dd.setDate(d.getDate() + i);
      arr.push(u.dateKey(dd));
    }
    return arr;
  }

  /* =======================================================================
     מסך בחירת תפקיד
     =======================================================================*/
  function renderRole() {
    const st = Store.get();
    return `
    <div class="screen active">
      <div class="role-wrap">
        <div class="role-hero">
          <div class="rh-logo">${esc((st.shop.name || "מ")[0])}</div>
          <h1>${esc(st.shop.name)}</h1>
          <p>${esc(st.shop.tagline || "קביעת תורים אונליין")}</p>
        </div>
        <div class="role-cards">
          <button class="role-card" data-act="enter-client">
            <div class="rc-ico">🙍‍♂️</div>
            <div class="rc-body">
              <div class="rc-title">כניסת לקוח</div>
              <div class="rc-sub">בחירת תור פנוי וקביעת תור</div>
            </div>
            <div class="rc-arrow">‹</div>
          </button>
          <button class="role-card" data-act="enter-owner">
            <div class="rc-ico">✂️</div>
            <div class="rc-body">
              <div class="rc-title">כניסת בעל העסק</div>
              <div class="rc-sub">ניהול יומן, שירותים ותורים</div>
            </div>
            <div class="rc-arrow">‹</div>
          </button>
        </div>
        <div class="conn-line" style="justify-content:center;margin-top:26px">
          <span class="conn-dot ${Store.mode === "cloud" ? "" : "local"}"></span>
          ${Store.mode === "cloud" ? "מחובר לענן — סנכרון בין כל המכשירים" : "מצב מקומי — סנכרון במכשיר זה"}
        </div>
      </div>
    </div>`;
  }

  /* =======================================================================
     כותרת עליונה משותפת
     =======================================================================*/
  function topbar(sub, opts) {
    opts = opts || {};
    const st = Store.get();
    const badge = opts.badge ? `<span class="badge-count">${opts.badge}</span>` : "";
    return `
    <div class="topbar">
      <div class="brand">
        <div class="logo-dot">${esc((st.shop.name || "מ")[0])}</div>
        <div class="titles">
          <h1>${esc(st.shop.name)}</h1>
          <p>${esc(sub)}</p>
        </div>
      </div>
      <div class="spacer"></div>
      ${opts.bell ? `<button class="icon-btn" data-act="enable-notif" title="התראות">🔔${badge}</button>` : ""}
      <button class="icon-btn" data-act="logout" title="החלפת תצוגה">⇋</button>
    </div>`;
  }

  /* =======================================================================
     צד לקוח
     =======================================================================*/
  function renderClient() {
    const st = Store.get();
    const activeServices = st.services.filter((s) => s.active !== false);
    if (!view.selService || !activeServices.find((s) => s.id === view.selService)) {
      view.selService = activeServices[0] ? activeServices[0].id : null;
    }
    const body = view.clientTab === "book" ? clientBook(st, activeServices) : clientMine(st);
    return `
    <div class="screen active">
      ${topbar("קביעת תור", { bell: true })}
      <div class="content" id="cscroll">${body}</div>
      <div class="tabbar">
        <button data-tab="book" class="${view.clientTab === "book" ? "active" : ""}">
          <span class="tb-ico">🗓️</span>קביעת תור</button>
        <button data-tab="mine" class="${view.clientTab === "mine" ? "active" : ""}">
          <span class="tb-ico">🎟️</span>התורים שלי</button>
      </div>
    </div>`;
  }

  function notifBanner() {
    if (!Notify.supported()) return "";
    if (Notify.permission() === "granted") return "";
    return `
    <div class="banner sky">
      <span class="bn-ico">🔔</span>
      <div class="bn-body">
        <div class="bn-title">קבלת תזכורת לפני התור</div>
        <div class="bn-sub">אפשרו התראות ותקבלו תזכורת שעה לפני התספורת</div>
      </div>
      <button class="btn btn-primary btn-sm" data-act="enable-notif" style="width:auto">אפשר</button>
    </div>`;
  }

  function arrivalBanner(st) {
    const now = Date.now();
    const upcoming = st.bookings
      .filter((b) => b.userId === identity.userId && b.status === "booked")
      .map((b) => ({ b, ts: u.dateTime(b.date, b.start).getTime() }))
      .filter((x) => x.ts > now && x.ts < now + 48 * 3600 * 1000)
      .sort((a, z) => a.ts - z.ts)[0];
    if (!upcoming) return "";
    const b = upcoming.b;
    return `
    <div class="banner good">
      <span class="bn-ico">📍</span>
      <div class="bn-body">
        <div class="bn-title">יש לך תור ${esc(u.relativeDay(b.date))} בשעה ${esc(b.start)}</div>
        <div class="bn-sub">${esc(b.serviceName)} · אשרו הגעה כדי לשמור את התור</div>
      </div>
      <button class="btn btn-primary btn-sm" data-act="confirm-arrival" data-id="${b.id}" style="width:auto">אשר הגעה</button>
    </div>`;
  }

  function clientBook(st, services) {
    if (!services.length) {
      return notifBanner() + emptyState("💈", "אין עדיין שירותים", "בעל העסק טרם הגדיר שירותים לקביעה");
    }
    // בורר שירות
    const svcCards = services.map((s) => `
      <button class="svc-card ${view.selService === s.id ? "selected" : ""}" data-svc="${s.id}">
        <div class="svc-ico">${esc(s.icon || "✂️")}</div>
        <div class="svc-body">
          <div class="svc-name">${esc(s.name)}</div>
          <div class="svc-sub">${u.fmtDuration(s.durationMin)}</div>
        </div>
        <div class="svc-price">${u.fmtPrice(s.price)}</div>
      </button>`).join("");

    const service = services.find((s) => s.id === view.selService);

    // בורר ימים (14 יום)
    const days = nextDays(14);
    if (!view.selDate || !days.includes(view.selDate)) {
      view.selDate = days.find((k) => st.schedule[u.parseKey(k).getDay()].active) || days[0];
    }
    const dayChips = days.map((k) => {
      const d = u.parseKey(k);
      const off = !st.schedule[d.getDay()].active;
      return `
      <button class="day-chip ${view.selDate === k ? "selected" : ""} ${off ? "off" : ""}"
              data-day="${k}" ${off ? "disabled" : ""}>
        <div class="dc-dow">${off ? "סגור" : u.DOW_SHORT[d.getDay()]}</div>
        <div class="dc-num">${d.getDate()}</div>
        <div class="dc-mon">${u.MON[d.getMonth()]}</div>
      </button>`;
    }).join("");

    // שעות
    let slotsHtml;
    const slots = service ? daySlots(view.selDate, service) : [];
    if (!st.schedule[u.parseKey(view.selDate).getDay()].active) {
      slotsHtml = emptyState("🚫", "סגור ביום זה", "בחרו יום אחר מהיומן");
    } else if (!slots.length) {
      slotsHtml = emptyState("⌛", "אין תורים פנויים", "כל התורים ליום זה תפוסים או שהיום הסתיים");
    } else {
      slotsHtml = `<div class="slots-grid">` + slots.map((s) => {
        if (s.taken) return `<div class="slot taken">${s.start}<span class="slot-tag">תפוס</span></div>`;
        return `<button class="slot ${view.selSlot === s.start ? "selected" : ""}" data-slot="${s.start}">${s.start}</button>`;
      }).join("") + `</div>`;
    }

    const canBook = service && view.selSlot && !!$;
    const ctaLabel = view.selSlot
      ? `קביעת תור · ${esc(view.selSlot)} ${esc(u.relativeDay(view.selDate))}`
      : "בחרו שעה לתור";

    return `
      ${notifBanner()}
      ${arrivalBanner(st)}
      <div class="section-title">בחירת שירות</div>
      <div class="svc-select">${svcCards}</div>

      <div class="section-title">בחירת יום</div>
      <div class="days-scroll">${dayChips}</div>

      <div class="section-title">${esc(u.longDate(view.selDate))} · שעות פנויות</div>
      ${slotsHtml}

      <div style="height:14px"></div>
      <button class="btn btn-primary" data-act="open-confirm" ${view.selSlot ? "" : "disabled"}>${ctaLabel}</button>
    `;
  }

  function clientMine(st) {
    const now = Date.now();
    const mine = st.bookings
      .filter((b) => b.userId === identity.userId && b.status !== "cancelled")
      .map((b) => ({ b, ts: u.dateTime(b.date, b.start).getTime() }))
      .sort((a, z) => a.ts - z.ts);
    const upcoming = mine.filter((x) => x.ts > now - 60 * 60000);
    const past = mine.filter((x) => x.ts <= now - 60 * 60000).reverse();

    if (!mine.length) {
      return emptyState("🎟️", "אין לך תורים", "עברו ל״קביעת תור״ כדי לקבוע את התור הראשון");
    }
    const card = (x, isPast) => {
      const b = x.b;
      const st2 = b.status === "confirmed"
        ? `<span class="status-tag status-confirmed">✓ אושר</span>`
        : `<span class="status-tag status-booked">ממתין</span>`;
      const actions = isPast ? "" : `
        <div class="btn-row" style="margin-top:12px">
          ${b.status !== "confirmed" ? `<button class="btn btn-sm" data-act="confirm-arrival" data-id="${b.id}">אשר הגעה</button>` : ""}
          <button class="btn btn-sm btn-danger" data-act="cancel-booking" data-id="${b.id}">ביטול תור</button>
        </div>`;
      return `
      <div class="card" style="padding:15px 16px;${isPast ? "opacity:.6" : ""}">
        <div class="booking" style="padding:0;border:none;background:none">
          <div class="bk-time">
            <div class="bt-h">${esc(b.start)}</div>
            <div class="bt-d">${esc(u.relativeDay(b.date))}</div>
          </div>
          <div class="bk-body">
            <div class="bk-title">${esc(b.serviceName)}</div>
            <div class="bk-sub">${esc(u.longDate(b.date))} · <b>${u.fmtPrice(b.price)}</b></div>
          </div>
          ${st2}
        </div>
        ${actions}
      </div>`;
    };
    let html = "";
    if (upcoming.length) {
      html += `<div class="section-title">תורים קרובים</div>` + upcoming.map((x) => card(x, false)).join("");
    }
    if (past.length) {
      html += `<div class="section-title">היסטוריה</div>` + past.map((x) => card(x, true)).join("");
    }
    return html;
  }

  /* ---------- מודאל אישור הזמנה ---------- */
  function openConfirm() {
    const st = Store.get();
    const service = st.services.find((s) => s.id === view.selService);
    if (!service || !view.selSlot) return;
    const needName = !identity.name;
    openModal(`
      <div class="m-title">אישור קביעת תור</div>
      <div class="m-sub">בדקו את הפרטים לפני האישור</div>
      <div class="summary-row"><span class="sr-k">שירות</span><span class="sr-v">${esc(service.name)}</span></div>
      <div class="summary-row"><span class="sr-k">תאריך</span><span class="sr-v">${esc(u.longDate(view.selDate))}</span></div>
      <div class="summary-row"><span class="sr-k">שעה</span><span class="sr-v">${esc(view.selSlot)}</span></div>
      <div class="summary-row"><span class="sr-k">משך</span><span class="sr-v">${u.fmtDuration(service.durationMin)}</span></div>
      <div class="summary-row"><span class="sr-k">מחיר</span><span class="sr-v big">${u.fmtPrice(service.price)}</span></div>
      <div style="height:18px"></div>
      <div class="field"><label>שם מלא</label>
        <input class="input" id="cf-name" placeholder="השם שלך" value="${esc(identity.name)}"></div>
      <div class="field"><label>טלפון</label>
        <input class="input" id="cf-phone" type="tel" inputmode="tel" placeholder="050-0000000" value="${esc(identity.phone)}"></div>
      <button class="btn btn-primary" data-act="do-book">אישור וקביעת התור</button>
      <button class="btn btn-ghost" data-act="close-modal" style="margin-top:8px">ביטול</button>
      ${needName ? `<p class="hint">כדי לקבל תזכורת מומלץ לאשר התראות לאחר הקביעה.</p>` : ""}
    `);
  }

  async function doBook() {
    const name = ($("#cf-name") && $("#cf-name").value.trim()) || "";
    const phone = ($("#cf-phone") && $("#cf-phone").value.trim()) || "";
    if (!name) { toast("נא להזין שם", "", "✋"); return; }
    identity.name = name; identity.phone = phone; saveIdentity();
    const btn = $("[data-act='do-book']"); if (btn) { btn.disabled = true; btn.textContent = "קובע תור…"; }
    const res = await Store.createBooking({
      serviceId: view.selService, date: view.selDate, start: view.selSlot,
      userId: identity.userId, userName: name, phone,
    });
    if (!res.ok) {
      closeModal();
      toast(res.reason || "לא ניתן לקבוע את התור", "", "⚠️");
      view.selSlot = null;
      render();
      return;
    }
    closeModal();
    view.selSlot = null;
    view.clientTab = "mine";
    toast("התור נקבע בהצלחה!", "good", "🎉");
    // תזמון תזכורת + הצעה לאשר התראות
    if (Notify.permission() === "granted") {
      Notify.scheduleReminders(Store.get().bookings, identity.userId, Store.get().shop);
    } else if (Notify.supported() && Notify.permission() === "default") {
      const r = await Notify.requestPermission();
      if (r === "granted") {
        toast("התראות הופעלו — נזכיר לך לפני התור", "sky", "🔔");
        Notify.scheduleReminders(Store.get().bookings, identity.userId, Store.get().shop);
      }
    }
    render();
  }

  /* =======================================================================
     צד בעל העסק
     =======================================================================*/
  function renderOwner() {
    const st = Store.get();
    const todayKey = u.dateKey(new Date());
    const now = Date.now();
    const todayCount = st.bookings.filter((b) => b.status !== "cancelled" && b.date === todayKey).length;
    let body;
    if (view.ownerTab === "cal") body = ownerCal(st);
    else if (view.ownerTab === "services") body = ownerServices(st);
    else if (view.ownerTab === "bookings") body = ownerBookings(st);
    else body = ownerSettings(st);

    const upcomingCount = st.bookings.filter((b) =>
      b.status !== "cancelled" && u.dateTime(b.date, b.start).getTime() > now).length;

    return `
    <div class="screen active">
      ${topbar("ניהול העסק", { bell: true })}
      <div class="content" id="oscroll">${body}</div>
      <div class="tabbar">
        <button data-otab="cal" class="${view.ownerTab === "cal" ? "active" : ""}"><span class="tb-ico">🗓️</span>יומן</button>
        <button data-otab="services" class="${view.ownerTab === "services" ? "active" : ""}"><span class="tb-ico">✂️</span>שירותים</button>
        <button data-otab="bookings" class="${view.ownerTab === "bookings" ? "active" : ""}">
          <span class="tb-ico" style="position:relative">🎟️${upcomingCount ? `<span class="badge-count" style="inset-inline-start:auto;inset-inline-end:-10px;top:-6px">${upcomingCount}</span>` : ""}</span>תורים</button>
        <button data-otab="settings" class="${view.ownerTab === "settings" ? "active" : ""}"><span class="tb-ico">⚙️</span>הגדרות</button>
      </div>
    </div>`;
  }

  function timeOptions(selected) {
    let html = "";
    for (let m = 6 * 60; m <= 24 * 60; m += 15) {
      const v = u.toHHMM(m % (24 * 60) === 0 && m !== 0 ? 24 * 60 - 0 : m);
      const label = m === 24 * 60 ? "24:00" : v;
      const val = m === 24 * 60 ? "23:59" : v;
      html += `<option value="${val}" ${val === selected ? "selected" : ""}>${label}</option>`;
    }
    return html;
  }

  function ownerCal(st) {
    const rows = [];
    for (let i = 0; i < 7; i++) {
      const d = st.schedule[i];
      rows.push(`
      <div class="day-row ${d.active ? "" : "off"}" data-day="${i}">
        <div class="dname">${u.DOW[i]}</div>
        <div class="dtimes">
          ${d.active ? `
            <select class="time-sel" data-time="open" data-day="${i}">${timeOptions(d.open)}</select>
            <span class="sep">עד</span>
            <select class="time-sel" data-time="close" data-day="${i}">${timeOptions(d.close)}</select>
          ` : `<span class="closed-tag">סגור</span>`}
        </div>
        <label class="switch">
          <input type="checkbox" data-active="${i}" ${d.active ? "checked" : ""}>
          <span class="track"></span><span class="thumb"></span>
        </label>
      </div>`);
    }
    return `
      <div class="section-title">ימי הפעילות ושעות העבודה</div>
      <div class="card">${rows.join("")}</div>
      <p class="hint">כל שינוי נשמר מיד ומתעדכן אצל הלקוחות בזמן אמת. שינוי שעות ישפיע רק על תורים חדשים — תורים שכבר נקבעו נשמרים.</p>
    `;
  }

  function ownerServices(st) {
    const items = st.services.map((s) => `
      <div class="card">
        <div class="service-item">
          <div class="svc-ico" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--surface-3);font-size:20px">${esc(s.icon || "✂️")}</div>
          <div class="si-main">
            <div class="si-name">${esc(s.name)}</div>
            <div class="si-meta"><span class="chip-price">${u.fmtPrice(s.price)}</span><span class="pill">⏱ ${u.fmtDuration(s.durationMin)}</span></div>
          </div>
          <button class="icon-btn" data-act="edit-svc" data-id="${s.id}">✏️</button>
        </div>
      </div>`).join("");
    return `
      <div class="section-title">השירותים שאתה מציע</div>
      ${items || emptyState("✂️", "אין שירותים", "הוסיפו את השירות הראשון")}
      <div style="height:14px"></div>
      <button class="btn btn-primary" data-act="add-svc">＋ הוספת שירות</button>
      <p class="hint">שם השירות, המחיר והמשך מתעדכנים אצל כל הלקוחות מיד.</p>
    `;
  }

  function svcModal(existing) {
    const s = existing || { name: "", price: "", durationMin: 30, icon: "✂️" };
    const icons = ["✂️", "🧔", "💈", "🪒", "👦", "💇‍♂️", "💇‍♀️", "✨"];
    openModal(`
      <div class="m-title">${existing ? "עריכת שירות" : "שירות חדש"}</div>
      <div class="m-sub">הפרטים יופיעו אצל הלקוחות</div>
      <div class="field"><label>סוג התספורת / השירות</label>
        <input class="input" id="sv-name" placeholder="לדוגמה: תספורת גבר" value="${esc(s.name)}"></div>
      <div class="field-row">
        <div class="field"><label>מחיר (₪)</label>
          <input class="input" id="sv-price" type="number" inputmode="numeric" min="0" placeholder="60" value="${esc(s.price)}"></div>
        <div class="field"><label>משך (דקות)</label>
          <input class="input" id="sv-dur" type="number" inputmode="numeric" min="5" step="5" placeholder="30" value="${esc(s.durationMin)}"></div>
      </div>
      <div class="field"><label>אייקון</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap" id="sv-icons">
          ${icons.map((ic) => `<button class="btn btn-sm" data-ic="${ic}" style="width:46px;font-size:20px;${ic === s.icon ? "border-color:var(--sky);box-shadow:0 0 0 2px var(--sky-glow)" : ""}">${ic}</button>`).join("")}
        </div>
      </div>
      <button class="btn btn-primary" data-act="save-svc" data-id="${existing ? existing.id : ""}">שמירה</button>
      ${existing ? `<button class="btn btn-danger" data-act="del-svc" data-id="${existing.id}" style="margin-top:8px">מחיקת שירות</button>` : `<button class="btn btn-ghost" data-act="close-modal" style="margin-top:8px">ביטול</button>`}
    `);
    // בחירת אייקון
    let chosen = s.icon;
    $("#sv-icons").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ic]"); if (!b) return;
      chosen = b.dataset.ic;
      [...$("#sv-icons").children].forEach((c) => (c.style.cssText = "width:46px;font-size:20px;"));
      b.style.cssText = "width:46px;font-size:20px;border-color:var(--sky);box-shadow:0 0 0 2px var(--sky-glow)";
    });
    $("#modal").__icon = () => chosen;
  }

  function ownerBookings(st) {
    const now = Date.now();
    const list = st.bookings
      .filter((b) => b.status !== "cancelled")
      .map((b) => ({ b, ts: u.dateTime(b.date, b.start).getTime() }))
      .sort((a, z) => a.ts - z.ts);
    const upcoming = list.filter((x) => x.ts > now - 30 * 60000);
    const past = list.filter((x) => x.ts <= now - 30 * 60000).reverse();

    if (!list.length) return emptyState("🎟️", "אין תורים עדיין", "כשלקוח יקבע תור הוא יופיע כאן");

    const row = (x, isPast) => {
      const b = x.b;
      const stg = b.status === "confirmed"
        ? `<span class="status-tag status-confirmed">✓ אישר הגעה</span>`
        : `<span class="status-tag status-booked">ממתין</span>`;
      return `
      <div class="booking" style="${isPast ? "opacity:.55" : ""}">
        <div class="bk-time">
          <div class="bt-h">${esc(b.start)}</div>
          <div class="bt-d">${esc(u.relativeDay(b.date))}</div>
        </div>
        <div class="bk-body">
          <div class="bk-title">${esc(b.userName || "לקוח")}</div>
          <div class="bk-sub">${esc(b.serviceName)} · ${b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : "ללא טלפון"}</div>
          <div class="bk-sub">${esc(u.longDate(b.date))}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          ${stg}
          ${!isPast ? `<button class="btn btn-sm btn-danger" data-act="owner-cancel" data-id="${b.id}">בטל</button>` : ""}
        </div>
      </div>`;
    };
    let html = "";
    if (upcoming.length) html += `<div class="section-title">תורים קרובים (${upcoming.length})</div>` + upcoming.map((x) => row(x, false)).join("");
    if (past.length) html += `<div class="section-title">היסטוריה</div>` + past.map((x) => row(x, true)).join("");
    return html;
  }

  function ownerSettings(st) {
    return `
      <div class="section-title">פרטי העסק</div>
      <div class="card">
        <div class="field"><label>שם העסק</label>
          <input class="input" id="set-name" value="${esc(st.shop.name)}"></div>
        <div class="field"><label>תיאור קצר</label>
          <input class="input" id="set-tag" value="${esc(st.shop.tagline || "")}"></div>
        <div class="field-row">
          <div class="field"><label>טלפון</label>
            <input class="input" id="set-phone" type="tel" value="${esc(st.shop.phone || "")}"></div>
          <div class="field"><label>מרווח בין תורים</label>
            <select class="input" id="set-step">
              ${[10, 15, 20, 30].map((n) => `<option value="${n}" ${st.shop.slotStep === n ? "selected" : ""}>${n} דקות</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field"><label>שליחת תזכורת ללקוח — כמה זמן לפני התור</label>
          <select class="input" id="set-remind">
            ${[30, 60, 90, 120].map((n) => `<option value="${n}" ${st.shop.reminderMinutes === n ? "selected" : ""}>${n} דקות לפני</option>`).join("")}
          </select>
        </div>
        <button class="btn btn-primary" data-act="save-settings">שמירת הגדרות</button>
      </div>

      <div class="section-title">התראות</div>
      <div class="card">
        <div class="conn-line" style="margin-bottom:12px">
          <span class="conn-dot ${Notify.permission() === "granted" ? "" : "local"}"></span>
          ${Notify.permission() === "granted" ? "התראות פעילות — תקבל הודעה על כל תור חדש" : "התראות כבויות"}
        </div>
        <button class="btn" data-act="enable-notif">${Notify.permission() === "granted" ? "בדיקת התראה" : "אפשר קבלת התראות על תורים חדשים"}</button>
      </div>

      <div class="section-title">חיבור</div>
      <div class="card">
        <div class="conn-line">
          <span class="conn-dot ${Store.mode === "cloud" ? "" : "local"}"></span>
          ${Store.mode === "cloud" ? "מחובר לענן (Firebase) — סנכרון מלא בין כל המכשירים" : "מצב מקומי — לסנכרון בין מכשירים ראו את קובץ README"}
        </div>
      </div>
    `;
  }

  /* =======================================================================
     מצב ריק
     =======================================================================*/
  function emptyState(ico, title, sub) {
    return `<div class="empty"><div class="em-ico">${ico}</div><b>${esc(title)}</b><p>${esc(sub)}</p></div>`;
  }

  /* =======================================================================
     רינדור ראשי
     =======================================================================*/
  function render() {
    if (!Store.get()) return;
    let html;
    if (view.route === "role") html = renderRole();
    else if (view.route === "owner") html = renderOwner();
    else html = renderClient();
    $("#root").innerHTML = html;
  }

  /* =======================================================================
     חיווט אירועים (delegation)
     =======================================================================*/
  function wire() {
    document.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-act],[data-svc],[data-day],[data-slot],[data-tab],[data-otab],[data-active]");
      if (!t) return;

      // בורר שירות
      if (t.dataset.svc) { view.selService = t.dataset.svc; view.selSlot = null; render(); return; }
      if (t.dataset.slot) { view.selSlot = t.dataset.slot; render(); return; }
      if (t.dataset.day && t.classList.contains("day-chip")) { view.selDate = t.dataset.day; view.selSlot = null; render(); return; }
      if (t.dataset.tab) { view.clientTab = t.dataset.tab; render(); return; }
      if (t.dataset.otab) { view.ownerTab = t.dataset.otab; render(); return; }

      const act = t.dataset.act;
      if (!act) return;

      switch (act) {
        case "enter-client": go("client"); break;
        case "enter-owner": promptOwner(); break;
        case "logout": go("role"); break;
        case "close-modal": closeModal(); break;

        case "open-confirm": openConfirm(); break;
        case "do-book": doBook(); break;

        case "confirm-arrival":
          await Store.setBookingStatus(t.dataset.id, "confirmed");
          toast("הגעתך אושרה ✓", "good", "📍"); render(); break;

        case "cancel-booking":
        case "owner-cancel":
          await Store.setBookingStatus(t.dataset.id, "cancelled");
          toast("התור בוטל", "", "🗑️"); render(); break;

        case "enable-notif": handleEnableNotif(); break;

        // שירותים
        case "add-svc": svcModal(null); break;
        case "edit-svc": {
          const svc = Store.get().services.find((s) => s.id === t.dataset.id);
          if (svc) svcModal(svc); break;
        }
        case "save-svc": saveSvc(t.dataset.id); break;
        case "del-svc":
          await Store.removeService(t.dataset.id); closeModal();
          toast("השירות נמחק", "", "🗑️"); render(); break;

        case "save-settings": saveSettings(); break;
      }
    });

    // יומן בעלים — מתגי הפעלה ושעות
    document.addEventListener("change", async (e) => {
      const a = e.target;
      if (a.dataset.active !== undefined && a.type === "checkbox") {
        await Store.setDay(Number(a.dataset.active), { active: a.checked });
        render();
      } else if (a.dataset.time) {
        const day = Number(a.dataset.day);
        const patch = {}; patch[a.dataset.time] = a.value;
        await Store.setDay(day, patch);
        toast("השעות עודכנו", "sky", "🕑");
      }
    });
  }

  function promptOwner() {
    if (localStorage.getItem("ug_owner_auth") === "1") { go("owner"); return; }
    openModal(`
      <div class="m-title">כניסת בעל העסק</div>
      <div class="m-sub">הזינו את קוד הכניסה</div>
      <div class="field"><input class="input" id="own-code" type="password" inputmode="numeric" placeholder="קוד" style="text-align:center;letter-spacing:4px;font-size:20px"></div>
      <button class="btn btn-primary" data-act2="check-code">כניסה</button>
      <button class="btn btn-ghost" data-act="close-modal" style="margin-top:8px">ביטול</button>
    `);
    const check = () => {
      const v = ($("#own-code") && $("#own-code").value.trim()) || "";
      if (v === String(UG_CONFIG.ownerPasscode)) {
        localStorage.setItem("ug_owner_auth", "1");
        closeModal(); go("owner");
      } else { toast("קוד שגוי", "", "🔒"); }
    };
    $("[data-act2='check-code']").addEventListener("click", check);
    $("#own-code").addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    setTimeout(() => $("#own-code") && $("#own-code").focus(), 100);
  }

  async function saveSvc(id) {
    const name = $("#sv-name").value.trim();
    const price = Number($("#sv-price").value);
    const durationMin = Number($("#sv-dur").value);
    const icon = $("#modal").__icon ? $("#modal").__icon() : "✂️";
    if (!name) { toast("נא להזין שם שירות", "", "✋"); return; }
    if (!(price >= 0) || !(durationMin >= 5)) { toast("בדקו מחיר ומשך", "", "✋"); return; }
    await Store.upsertService({ id: id || undefined, name, price, durationMin, icon });
    closeModal(); toast("השירות נשמר ✓", "good", "✂️"); render();
  }

  async function saveSettings() {
    await Store.saveShop({
      name: $("#set-name").value.trim() || "המספרה",
      tagline: $("#set-tag").value.trim(),
      phone: $("#set-phone").value.trim(),
      slotStep: Number($("#set-step").value),
      reminderMinutes: Number($("#set-remind").value),
    });
    toast("ההגדרות נשמרו ✓", "good", "⚙️"); render();
  }

  async function handleEnableNotif() {
    if (!Notify.supported()) { toast("הדפדפן אינו תומך בהתראות", "", "⚠️"); return; }
    if (Notify.permission() === "granted") {
      Notify.show("בדיקת התראה 🔔", "מצוין! ההתראות עובדות.", { tag: "test" });
      toast("נשלחה התראת בדיקה", "sky", "🔔");
      return;
    }
    const r = await Notify.requestPermission();
    if (r === "granted") {
      toast("התראות הופעלו ✓", "good", "🔔");
      const st = Store.get();
      if (view.route === "client") Notify.scheduleReminders(st.bookings, identity.userId, st.shop);
      render();
    } else if (r === "denied") {
      toast("ההתראות נחסמו — ניתן לאפשר בהגדרות הדפדפן", "", "🔕");
    }
  }

  /* =======================================================================
     תגובה לשינויים מהחנות (זמן אמת)
     =======================================================================*/
  function onStoreChange(st) {
    // התראת "תור חדש" לבעלים
    if (view.route === "owner") {
      if (!ownerSeen) {
        ownerSeen = new Set(st.bookings.map((b) => b.id)); // זריעה ראשונית — ללא התראה
      } else {
        const fresh = st.bookings.filter((b) => b.status !== "cancelled" && !ownerSeen.has(b.id));
        fresh.forEach((b) => {
          ownerSeen.add(b.id);
          toast(`תור חדש: ${b.userName} · ${b.serviceName} ${u.relativeDay(b.date)} ${b.start}`, "sky", "🎉");
          Notify.show("📅 תור חדש נקבע", `${b.userName} — ${b.serviceName}\n${u.longDate(b.date)} בשעה ${b.start}`, { tag: "newbook-" + b.id });
        });
      }
    } else if (ownerSeen) {
      st.bookings.forEach((b) => ownerSeen.add(b.id));
    }
    // תזמון תזכורות ללקוח
    if (view.route === "client" && Notify.permission() === "granted") {
      Notify.scheduleReminders(st.bookings, identity.userId, st.shop);
    }
    // רינדור מחדש (אלא אם מקלידים כרגע)
    if (!isEditingRoot()) render();
  }

  /* =======================================================================
     אתחול
     =======================================================================*/
  async function boot() {
    Notify.registerSW();
    wire();
    await Store.init();
    Store.subscribe(onStoreChange);
    if (view.route === "owner" && localStorage.getItem("ug_owner_auth") !== "1") view.route = "client";
    render();
    // תזמון תזכורות בעת עלייה
    if (view.route === "client" && Notify.permission() === "granted") {
      Notify.scheduleReminders(Store.get().bookings, identity.userId, Store.get().shop);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
