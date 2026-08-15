/* ========================================================================
   server.js — KPSS 2026 Ortaöğretim backend giriş noktası
   ======================================================================== */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { aiRateLimit } = require("./middleware/rateLimit");

const aiRoutes = require("./routes/ai");
const searchRoutes = require("./routes/search");
const currentAffairsRoutes = require("./routes/currentAffairs");
const questionsRoutes = require("./routes/questions");
const progressRoutes = require("./routes/progress");
const adminRoutes = require("./routes/admin");

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => res.json({ ok: true, servis: "KPSS 2026 Backend", zaman: new Date().toISOString() }));
app.get("/health", (req, res) => res.json({ ok: true }));

// Tek frontend isteği 20 soruluk denemeye dönüşür; günlük limit yine tek kez uygulanır.
app.use("/api/ai/generate-mixed-test", aiRateLimit);
app.use("/api/ai/generate-mock-exam", aiRateLimit);
app.use("/api/ai", aiRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/current-affairs", currentAffairsRoutes);
app.use("/api/questions", questionsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ hata: "Uç bulunamadı." }));
app.use((err, req, res, next) => {
  console.error("[genel hata]", err);
  res.status(500).json({ hata: "Sunucuda beklenmeyen bir hata oluştu." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`KPSS 2026 backend çalışıyor: http://0.0.0.0:${PORT}`));
