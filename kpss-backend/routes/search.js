/* ==========================================================================
   routes/search.js
   GET /api/search?q=... — genel amaçlı, güvenilir kaynak öncelikli arama proxy.
   ========================================================================== */

const express = require("express");
const { searchWeb } = require("../services/webSearch");

const router = express.Router();

router.get("/", async (req, res) => {
  const q = req.query.q;
  if (!q || !q.trim()) {
    return res.status(400).json({ hata: "q parametresi zorunludur." });
  }
  try {
    const sonuclar = await searchWeb(q, { onlyTrusted: req.query.trusted === "true" });
    res.json({ sonuclar });
  } catch (err) {
    console.error("[search]", err.message);
    res.status(503).json({ hata: "Güncel bilgi alınamadı." });
  }
});

module.exports = router;
