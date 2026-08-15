const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db/db");

const router = express.Router();

function userIdAl(req, res) {
  const userId = req.header("X-User-Id");
  if (!userId) {
    res.status(400).json({ hata: "X-User-Id header eksik." });
    return null;
  }
  return userId;
}

function sayi(value, varsayilan = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : varsayilan;
}

function yuzde(dogru, toplam) {
  return toplam ? Math.round((dogru / toplam) * 100) : 0;
}

function detayGuvenli(detay) {
  if (Array.isArray(detay)) return detay.slice(0, 100);
  if (detay && typeof detay === "object") return detay;
  return [];
}

router.post("/test-result", (req, res) => {
  const userId = userIdAl(req, res);
  if (!userId) return;

  const { testTuru = "konu", dogru, yanlis, bos, detay } = req.body || {};
  const d = sayi(dogru);
  const y = sayi(yanlis);
  const b = sayi(bos);

  if (d + y + b === 0 || d + y + b > 500) {
    return res.status(400).json({ hata: "Geçerli bir test sonucu gönderilmedi." });
  }

  const izinliTurler = ["guncel", "konu", "kisisel", "karma", "deneme"];
  const tur = izinliTurler.includes(testTuru) ? testTuru : "konu";
  const id = nanoid();

  db.prepare(`
    INSERT INTO test_results (id, user_id, test_turu, dogru, yanlis, bos, detay)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, tur, d, y, b, JSON.stringify(detayGuvenli(detay)));

  res.json({
    ok: true,
    id,
    toplam: d + y + b,
    basariYuzdesi: yuzde(d, d + y + b)
  });
});

router.get("/history", (req, res) => {
  const userId = userIdAl(req, res);
  if (!userId) return;

  const limit = Math.min(Math.max(sayi(req.query.limit, 10), 1), 50);
  const kayitlar = db.prepare(`
    SELECT id, test_turu, dogru, yanlis, bos, detay, created_at
    FROM test_results
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);

  res.json({
    testler: kayitlar.map(k => ({
      id: k.id,
      testTuru: k.test_turu,
      dogru: k.dogru,
      yanlis: k.yanlis,
      bos: k.bos,
      toplam: k.dogru + k.yanlis + k.bos,
      basariYuzdesi: yuzde(k.dogru, k.dogru + k.yanlis + k.bos),
      detay: (() => { try { return JSON.parse(k.detay || "[]"); } catch { return []; } })(),
      tarih: k.created_at
    }))
  });
});

router.post("/study-session", (req, res) => {
  const userId = userIdAl(req, res);
  if (!userId) return;

  const dakika = sayi(req.body?.dakika);
  if (dakika < 1 || dakika > 1440) {
    return res.status(400).json({ hata: "Çalışma süresi 1 ile 1440 dakika arasında olmalıdır." });
  }

  const id = nanoid();
  db.prepare(`
    INSERT INTO study_sessions (id, user_id, subject, dakika)
    VALUES (?, ?, ?, ?)
  `).run(id, userId, String(req.body?.subject || "Genel").slice(0, 80), dakika);

  res.json({ ok: true, id, dakika });
});

router.get("/summary", (req, res) => {
  const userId = userIdAl(req, res);
  if (!userId) return;

  const toplam = db.prepare(`
    SELECT COUNT(*) AS test_sayisi,
           COALESCE(SUM(dogru), 0) AS dogru,
           COALESCE(SUM(yanlis), 0) AS yanlis,
           COALESCE(SUM(bos), 0) AS bos
    FROM test_results WHERE user_id = ?
  `).get(userId);

  const calisma = db.prepare(`
    SELECT COALESCE(SUM(dakika), 0) AS dakika
    FROM study_sessions WHERE user_id = ?
  `).get(userId);

  const yanlisSayisi = db.prepare(`
    SELECT COUNT(*) AS sayi FROM wrong_questions WHERE user_id = ?
  `).get(userId).sayi;

  const sonTestler = db.prepare(`
    SELECT test_turu, dogru, yanlis, bos, created_at
    FROM test_results WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 5
  `).all(userId);

  const toplamSoru = toplam.dogru + toplam.yanlis + toplam.bos;

  res.json({
    toplam: {
      testSayisi: toplam.test_sayisi,
      soruSayisi: toplamSoru,
      dogru: toplam.dogru,
      yanlis: toplam.yanlis,
      bos: toplam.bos,
      basariYuzdesi: yuzde(toplam.dogru, toplamSoru),
      calismaDakikasi: calisma.dakika,
      calismaSaati: Math.round((calisma.dakika / 60) * 10) / 10,
      yanlisSayisi
    },
    sonTestler: sonTestler.map(k => ({
      testTuru: k.test_turu,
      dogru: k.dogru,
      yanlis: k.yanlis,
      bos: k.bos,
      basariYuzdesi: yuzde(k.dogru, k.dogru + k.yanlis + k.bos),
      tarih: k.created_at
    }))
  });
});

module.exports = router;
