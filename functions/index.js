/* =========================================================================
   Cloud Function — שליחת התראות פוש (FCM) לטלפונים, גם כשהאפליקציה סגורה.
   מופעל אוטומטית בכל שינוי במסמך shops/main:
     • התפנה תור (alert חדש)  → הודעה לכל מי שברשימת ההמתנה לאותה שעה.
     • תור חדש (booking חדש)  → הודעה למכשיר של המנהל.
   -------------------------------------------------------------------------
   אם ה-deploy נכשל עם שגיאת region/location — שנו את REGION למטה לאזור שבו
   נוצר ה-Firestore שלכם (מופיע ב-Console → Firestore Database, למשל
   "europe-west1" או "eur3" או "nam5").
   =========================================================================*/
const REGION = "europe-west1";

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 5 });

const db = admin.firestore();

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

async function tokensFor(uid) {
  const snap = await db.collection("pushTokens").doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  return data && Array.isArray(data.tokens) ? data.tokens : [];
}

async function sendToUid(uid, title, body, tag) {
  const tokens = await tokensFor(uid);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title: title, body: body, tag: tag || "" },
    android: { priority: "high" },
    apns: { headers: { "apns-priority": "10" } },
  });
  // ניקוי טוקנים שכבר לא תקפים
  const bad = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument" ||
          code === "messaging/invalid-registration-token") {
        bad.push(tokens[i]);
      }
    }
  });
  if (bad.length) {
    await db.collection("pushTokens").doc(uid).set(
      { tokens: admin.firestore.FieldValue.arrayRemove(...bad) },
      { merge: true }
    );
  }
}

exports.onShopUpdate = onDocumentUpdated("shops/main", async (event) => {
  const before = (event.data.before && event.data.before.data()) || {};
  const after = (event.data.after && event.data.after.data()) || {};
  const shopName = (after.shop && after.shop.name) || "המספרה";

  const beforeAlerts = new Set((before.alerts || []).map((a) => a.id));
  const newAlerts = (after.alerts || []).filter((a) => !beforeAlerts.has(a.id));

  const beforeBookings = new Set((before.bookings || []).map((b) => b.id));
  const newBookings = (after.bookings || [])
    .filter((b) => !beforeBookings.has(b.id) && b.status !== "cancelled");

  const jobs = [];

  // 1) התפנה תור → למי שברשימת ההמתנה
  for (const a of newAlerts) {
    jobs.push(sendToUid(
      a.userId,
      "🎉 התפנה תור!",
      `${relDay(a.date)} בשעה ${a.start} — מהרו להזמין לפני שייתפס · ${shopName}`,
      "freed-" + a.id
    ));
  }

  // 2) תור חדש → למכשיר של המנהל
  for (const b of newBookings) {
    jobs.push(sendToUid(
      "owner",
      "📅 תור חדש נקבע",
      `${b.userName} — ${b.serviceName}, ${relDay(b.date)} בשעה ${b.start}`,
      "newbook-" + b.id
    ));
  }

  await Promise.all(jobs);
});
