/* ==========================================================================
   server.js — KPSS 2026 Ortaöğretim backend giriş noktası
   ========================================================================== */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const aiRoutes = require("./routes/ai");
const searchRoutes = require("./routes/search");
const currentAffairsRoutes = require("./routes/currentAffairs");
const questionsRoutes = require("./routes/questions");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" })); // fotoğraf base64 için yeterli limit

app.get("/", (req, res) => {
  res.json({ ok: true, servis: "KPSS 2026 Backend", zaman: new Date().toISOString() });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/ai", aiRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/current-affairs", currentAffairsRoutes);
app.use("/api/questions", questionsRoutes);
app.use("/api/admin", adminRoutes);

// Bilinmeyen uç
app.use((req, res) => {
  res.status(404).json({ hata: "Uç bulunamadı." });
});

// Genel hata yakalayıcı — uygulama asla çökmesin (özellik 27)
app.use((err, req, res, next) => {
  console.error("[genel hata]", err);
  res.status(500).json({ hata: "Sunucuda beklenmeyen bir hata oluştu." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KPSS 2026 backend çalışıyor: http://localhost:${PORT}`);
});
