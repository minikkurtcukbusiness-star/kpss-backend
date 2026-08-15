/* ==========================================================================
   routes/admin.js
   Tüm uçlar "X-Admin-Token" header'ı ile korunur (.env → ADMIN_TOKEN).
   Basit bir panel için yeterlidir; büyürse gerçek admin girişi eklenebilir.
   ========================================================================== */

const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db/db");

const router = express.Router();

router.use((req, res, next) => {
  const token = req.header("X-Admin-Token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ hata: "Yetkisiz. Geçerli X-Admin-Token header'ı gerekli." });
  }
  next();
});

// --- Sorular ---
router.get("/questions", (req, res) => {
  const sorular = db.prepare("SELECT * FROM questions ORDER BY created_at DESC LIMIT 200").all();
  res.json({ sorular });
});

router.post("/questions", (req, res) => {
  const { subject, topic, question, options, correctAnswer, explanation, difficulty } = req.body;
  const id = nanoid();
  db.prepare(`INSERT INTO questions (id, subject, topic, question, options, correct_answer, explanation, difficulty, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin')`).run(
    id, subject, topic, question, JSON.stringify(options), correctAnswer, explanation, difficulty
  );
  res.json({ id });
});

router.put("/questions/:id", (req, res) => {
  const { subject, topic, question, options, correctAnswer, explanation, difficulty } = req.body;
  db.prepare(`UPDATE questions SET subject=?, topic=?, question=?, options=?, correct_answer=?, explanation=?, difficulty=? WHERE id=?`).run(
    subject, topic, question, JSON.stringify(options), correctAnswer, explanation, difficulty, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/questions/:id", (req, res) => {
  db.prepare("DELETE FROM questions WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Güncel bilgiler ---
router.post("/current-affairs", (req, res) => {
  const { title, summary, category, sourceName, sourceUrl } = req.body;
  const id = nanoid();
  const bugun = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO current_affairs (id, title, summary, category, published_at, source_name, source_url)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, title, summary, category, bugun, sourceName, sourceUrl);
  res.json({ id });
});

router.delete("/current-affairs/:id", (req, res) => {
  db.prepare("DELETE FROM current_affairs WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM sources WHERE current_affairs_id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Raporlanan sorular ---
router.get("/reported-questions", (req, res) => {
  const kayitlar = db.prepare(`
    SELECT rq.*, q.question, q.subject, q.topic
    FROM reported_questions rq
    LEFT JOIN questions q ON q.id = rq.question_id
    ORDER BY rq.created_at DESC
  `).all();
  res.json({ kayitlar });
});

// --- Limitler ---
router.post("/settings/limits", (req, res) => {
  const { freeDailyLimit, premiumDailyLimit } = req.body;
  if (freeDailyLimit != null) {
    db.prepare("INSERT INTO settings (anahtar, deger) VALUES ('free_daily_limit', ?) ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger")
      .run(String(freeDailyLimit));
  }
  if (premiumDailyLimit != null) {
    db.prepare("INSERT INTO settings (anahtar, deger) VALUES ('premium_daily_limit', ?) ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger")
      .run(String(premiumDailyLimit));
  }
  res.json({ ok: true });
});

module.exports = router;
