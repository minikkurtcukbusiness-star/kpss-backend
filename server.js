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
app.disable("x-powered-by");
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => res.json({ ok: true, servis: "KPSS 2026 Backend", zaman: new Date().toISOString() }));
app.get("/health", (req, res) => res.json({ ok: true, servis: "KPSS 2026 Backend", zaman: new Date().toISOString() }));

app.use("/api/ai/generate-mixed-test", aiRateLimit);
app.use("/api/ai/generate-mock-exam", aiRateLimit);
app.use("/api/ai", aiRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/current-affairs", currentAffairsRoutes);
app.use("/api/questions", questionsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ hata: "Uç bulunamadı.", yol: req.originalUrl, yontem: req.method }));
app.use((err, req, res, next) => {
  console.error("[genel hata]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ hata: "Sunucuda beklenmeyen bir hata oluştu." });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[KPSS] backend çalışıyor: http://0.0.0.0:${PORT}`);
  console.log(`[KPSS] AI deneme uçları: /api/ai/generate-mixed-test, /api/ai/generate-mock-exam`);
  console.log(`[KPSS] OpenRouter anahtarı: ${process.env.OPENROUTER_API_KEY ? "var" : "YOK"}`);
});

let kapanıyor = false;
function gracefulShutdown(signal) {
  if (kapanıyor) return;
  kapanıyor = true;
  console.log(`[KPSS] ${signal} alındı; mevcut istekler tamamlanıyor...`);
  server.close(() => {
    console.log("[KPSS] HTTP sunucusu güvenli şekilde kapandı.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[KPSS] Kapanış zaman aşımına uğradı.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", err => console.error("[KPSS] uncaughtException", err));
process.on("unhandledRejection", err => console.error("[KPSS] unhandledRejection", err));
