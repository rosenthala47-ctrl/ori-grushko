/* =========================================================================
   שולח התראות פוש (FCM) — רץ ב-GitHub Actions כל כמה דקות.
   קורא את מסמך shops/main, מזהה alerts/bookings חדשים שעוד לא טופלו,
   ושולח הודעת פוש לטלפונים הרשומים. בלי Firebase Functions ובלי Blaze.
   דורש secret בשם FIREBASE_SERVICE_ACCOUNT (מפתח service account, JSON).
   =========================================================================*/
const admin = require("firebase-admin");

const DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function relDay(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return "יום " + DOW[target.getDay()];
}
function apptTs(date, start) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = start.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

(async () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error("חסר secret: FIREBASE_SERVICE_ACCOUNT"); process.exit(1); }
  let creds;
  try { creds = JSON.parse(raw); }
  catch (e) { console.error("FIREBASE_SERVICE_ACCOUNT אינו JSON תקין"); process.exit(1); }

  admin.initializeApp({ credential: admin.credential.cert(creds) });
  const db = admin.firestore();
  const messaging = admin.messaging();

  const shopSnap = await db.doc("shops/main").get();
  if (!shopSnap.exists) { console.log("אין מסמך shops/main — יוצאים."); return; }
  const shop = shopSnap.data();
  const alerts = Array.isArray(shop.alerts) ? shop.alerts : [];
  const bookings = Array.isArray(shop.bookings) ? shop.bookings : [];
  const shopName = (shop.shop && shop.shop.name) || "המספרה";

  const stateRef = db.doc("system/pushState");
  const stateSnap = await stateRef.get();
  const firstRun = !stateSnap.exists;
  const stData = stateSnap.exists ? stateSnap.data() : {};
  const doneAlerts = new Set(stData.alertIds || []);
  const doneBookings = new Set(stData.bookingIds || []);

  const now = Date.now();
  const newAlerts = alerts.filter((a) => a && a.id && !doneAlerts.has(a.id) && apptTs(a.date, a.start) > now);
  const newBookings = bookings.filter((b) =>
    b && b.id && !doneBookings.has(b.id) && b.status !== "cancelled" && apptTs(b.date, b.start) > now);

  // סמן את כל מה שקיים כרגע כ"טופל" — כדי לא לשלוח פעמיים
  alerts.forEach((a) => a && a.id && doneAlerts.add(a.id));
  bookings.forEach((b) => b && b.id && doneBookings.add(b.id));

  const saveState = () => stateRef.set({
    alertIds: [...doneAlerts].slice(-800),
    bookingIds: [...doneBookings].slice(-800),
    updatedAt: now,
  });

  if (firstRun) {
    await saveState();
    console.log("ריצה ראשונה — סימון מצב קיים בלבד, ללא שליחה.");
    return;
  }

  async function tokensFor(uid) {
    const s = await db.doc("pushTokens/" + uid).get();
    const d = s.exists ? s.data() : null;
    return d && Array.isArray(d.tokens) ? d.tokens : [];
  }
  async function sendToUid(uid, title, body, tag) {
    const tokens = await tokensFor(uid);
    if (!tokens.length) return 0;
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: { title: title, body: body, tag: tag || "" },
      android: { priority: "high" },
      apns: { headers: { "apns-priority": "10" } },
    });
    const bad = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const c = r.error && r.error.code;
        if (c === "messaging/registration-token-not-registered" ||
            c === "messaging/invalid-argument" ||
            c === "messaging/invalid-registration-token") bad.push(tokens[i]);
      }
    });
    if (bad.length) {
      await db.doc("pushTokens/" + uid).set(
        { tokens: admin.firestore.FieldValue.arrayRemove(...bad) }, { merge: true });
    }
    return res.successCount;
  }

  let sent = 0;
  for (const a of newAlerts) {
    sent += await sendToUid(a.userId, "🎉 התפנה תור!",
      `${relDay(a.date)} בשעה ${a.start} — מהרו להזמין לפני שייתפס · ${shopName}`, "freed-" + a.id);
  }
  for (const b of newBookings) {
    sent += await sendToUid("owner", "📅 תור חדש נקבע",
      `${b.userName} — ${b.serviceName}, ${relDay(b.date)} בשעה ${b.start}`, "newbook-" + b.id);
  }

  await saveState();
  console.log(`הושלם. alerts חדשים=${newAlerts.length}, bookings חדשים=${newBookings.length}, פושים שנשלחו=${sent}`);
})().catch((e) => { console.error(e); process.exit(1); });
