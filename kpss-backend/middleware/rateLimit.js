/* ==========================================================================
   middleware/rateLimit.js
   Kullanıcı bazlı günlük AI istek limiti.
   Kullanıcı kimliği header'dan gelir: X-User-Id (frontend, cihaza özel
   rastgele bir kimliği localStorage'da üretip her istekte gönderir).
   Limitler settings tablosundan (admin panelinden değiştirilebilir),
   yoksa .env'den okunur.
   ========================================================================== */

const db = require("../db/db");

function bugun() {
  return new Date().toISOString().slice(0, 10);
}

function limitOku(tip) {
  const satir = db.prepare("SELECT deger FROM settings WHERE anahtar = ?").get(
    tip === "premium" ? "premium_daily_limit" : "free_daily_limit"
  );
  if (satir) return Number(satir.deger);
  return tip === "premium"
    ? Number(process.env.PREMIUM_DAILY_LIMIT) || 100
    : Number(process.env.FREE_DAILY_LIMIT) || 10;
}

function aiRateLimit(req, res, next) {
  const userId = req.header("X-User-Id");
  if (!userId) {
    return res.status(400).json({ hata: "X-User-Id header eksik." });
  }

  const kullanici = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const tip = kullanici?.tip || "ucretsiz";
  const limit = limitOku(tip);
  const gun = bugun();

  let kayit = db.prepare("SELECT * FROM ai_requests WHERE user_id = ? AND gun = ?").get(userId, gun);

  if (!kayit) {
    db.prepare("INSERT INTO ai_requests (id, user_id, gun, sayi) VALUES (?, ?, ?, 0)").run(
      `${userId}_${gun}`, userId, gun
    );
    kayit = { sayi: 0 };
  }

  if (kayit.sayi >= limit) {
    return res.status(429).json({
      hata: `Günlük yapay zekâ kullanım limitine ulaştın (${limit} istek). Yarın tekrar deneyebilirsin.`
    });
  }

  db.prepare("UPDATE ai_requests SET sayi = sayi + 1 WHERE user_id = ? AND gun = ?").run(userId, gun);
  next();
}

module.exports = { aiRateLimit };
