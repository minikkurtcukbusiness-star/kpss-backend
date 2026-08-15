/* ==========================================================================
   routes/ai.js
   - POST /api/ai/teacher          → AI Öğretmen (gerekirse web aramasıyla desteklenir)
   - POST /api/ai/generate-questions → Konu bazlı özgün soru üretimi + kalite kontrolü
   - POST /api/ai/solve-image      → Fotoğraftan soru çözme (Gemini Vision)
   ========================================================================== */

const express = require("express");
const { nanoid } = require("nanoid");
const aiProvider = require("../services/aiProvider");
const { searchWeb } = require("../services/webSearch");
const { aiRateLimit } = require("../middleware/rateLimit");
const db = require("../db/db");

const router = express.Router();

const SINAV_SISTEM_TALIMATI = `Sen 2026 KPSS Ortaöğretim sınavına hazırlanan bir öğrenciye yardımcı olan, uzman bir KPSS öğretmenisin.
- Genel bir sohbet botu gibi davranma; her zaman KPSS sınavı bağlamında, öz ve anlaşılır cevap ver.
- Cevaplarını Türkçe ver.
- Emin olmadığın veya doğrulayamadığın güncel bir bilgi varsa bunu açıkça belirt, uydurma.
- Sana kaynak metinleri verilmişse cevabını öncelikle bu kaynaklara dayandır.`;

function guncelBilgiGerekiyorMu(soru) {
  const anahtarKelimeler = [
    "güncel", "şu an", "şu anda", "kim", "2026", "2025", "bu yıl", "son",
    "yeni", "değişti", "değişiklik", "atandı", "seçildi", "kazandı"
  ];
  const kucuk = soru.toLocaleLowerCase("tr");
  return anahtarKelimeler.some(k => kucuk.includes(k));
}

function aiUsageKaydet(userId, islem) {
  db.prepare("INSERT INTO ai_usage (id, user_id, islem, saglayici) VALUES (?, ?, ?, ?)").run(
    nanoid(), userId || null, islem, process.env.AI_PROVIDER || "gemini"
  );
}

function guvenliJsonAyristir(metin) {
  try {
    // Model bazen ```json ... ``` bloğu ile sarabilir, temizle.
    const temiz = metin.replace(/```json|```/g, "").trim();
    return JSON.parse(temiz);
  } catch {
    return null;
  }
}

/* ---------------------------- AI ÖĞRETMEN ---------------------------- */

router.post("/teacher", aiRateLimit, async (req, res) => {
  const { soru } = req.body;
  const userId = req.header("X-User-Id");

  if (!soru || !soru.trim()) {
    return res.status(400).json({ hata: "Soru boş olamaz." });
  }

  try {
    let kaynaklar = [];
    let kaynakMetni = "";

    if (guncelBilgiGerekiyorMu(soru)) {
      kaynaklar = await searchWeb(soru, { onlyTrusted: true, limit: 5 });
      if (kaynaklar.length > 0) {
        kaynakMetni =
          "\n\nAşağıdaki güncel kaynakları dikkate alarak cevap ver:\n" +
          kaynaklar
            .map((k, i) => `[${i + 1}] ${k.baslik} (${k.kaynak}) — ${k.icerikOzeti}`)
            .join("\n");
      }
    }

    const cevapMetni = await aiProvider.generate({
      system: SINAV_SISTEM_TALIMATI,
      prompt: `Öğrenci sorusu: "${soru}"${kaynakMetni}\n\nKısa, anlaşılır ve KPSS odaklı cevap ver. Uygunsa "📌 KPSS'de önemli", "⚠ Karıştırma", "🧠 Ezberle" gibi başlıklar kullan.`
    });

    aiUsageKaydet(userId, "teacher");

    res.json({
      cevap: cevapMetni,
      kaynaklar: kaynaklar.map(k => ({ baslik: k.baslik, url: k.url, kaynak: k.kaynak, tarih: k.tarih })),
      belirsiz: kaynaklar.length === 0 && guncelBilgiGerekiyorMu(soru)
    });
  } catch (err) {
    console.error("[ai/teacher]", err.message);
    res.status(503).json({ hata: "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen birkaç dakika sonra tekrar deneyin." });
  }
});

/* ------------------------ SORU ÜRETME + KALİTE KONTROLÜ ------------------------ */

async function soruUret({ subject, topic, difficulty, count }) {
  const prompt = `KPSS Ortaöğretim seviyesinde, "${subject}" dersinin "${topic}" konusunda, "${difficulty}" zorlukta, TAMAMEN ÖZGÜN ${count} adet çoktan seçmeli soru üret.
Kurallar:
- Her sorunun tek bir doğru cevabı olmalı.
- Çeldiriciler mantıklı ve konuyla ilgili olmalı.
- Telif hakkı olan yayınlardan doğrudan kopya yapma, kendi cümlelerinle özgün soru yaz.
- Yalnızca aşağıdaki JSON formatında, başka hiçbir açıklama eklemeden cevap ver:
[
  {
    "soru": "...",
    "secenekler": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
    "dogruCevap": "A",
    "aciklama": "..."
  }
]`;

  const metin = await aiProvider.generate({
    system: "Sen özgün KPSS soruları hazırlayan bir soru yazarısın. Yalnızca istenen JSON formatında cevap ver.",
    prompt,
    jsonMode: true
  });

  const sorular = guvenliJsonAyristir(metin);
  return Array.isArray(sorular) ? sorular : [];
}

function soruGecerliMi(s) {
  if (!s || typeof s !== "object") return false;
  if (!s.soru || typeof s.soru !== "string" || s.soru.length < 8) return false;
  if (!s.secenekler || typeof s.secenekler !== "object") return false;
  const anahtarlar = Object.keys(s.secenekler);
  if (!["A", "B", "C", "D", "E"].every(h => anahtarlar.includes(h))) return false;
  if (!s.dogruCevap || !["A", "B", "C", "D", "E"].includes(s.dogruCevap)) return false;
  // Şıklar birbirinin aynısı olmasın
  const degerler = Object.values(s.secenekler).map(v => String(v).trim().toLowerCase());
  if (new Set(degerler).size !== degerler.length) return false;
  return true;
}

router.post("/generate-questions", aiRateLimit, async (req, res) => {
  const { subject, topic, difficulty = "orta", count = 5 } = req.body;
  const userId = req.header("X-User-Id");

  if (!subject || !topic) {
    return res.status(400).json({ hata: "Ders ve konu zorunludur." });
  }

  const guvenliSayi = Math.max(1, Math.min(Number(count) || 5, 20));

  try {
    let sorular = await soruUret({ subject, topic, difficulty, count: guvenliSayi });

    // Kalite kontrolü: formatı bozuk soruları ele
    let gecerliSorular = sorular.filter(soruGecerliMi);

    // Yetersizse bir kez daha dene (özellik 11: hatalıysa yeniden oluştur)
    if (gecerliSorular.length < guvenliSayi) {
      const eksik = guvenliSayi - gecerliSorular.length;
      const ekSorular = await soruUret({ subject, topic, difficulty, count: eksik });
      gecerliSorular = gecerliSorular.concat(ekSorular.filter(soruGecerliMi));
    }

    // DB'ye kaydet
    const kaydedilenler = gecerliSorular.slice(0, guvenliSayi).map(s => {
      const id = nanoid();
      db.prepare(`INSERT INTO questions (id, subject, topic, question, options, correct_answer, explanation, difficulty, source, created_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL)`).run(
        id, subject, topic, s.soru, JSON.stringify(s.secenekler), s.dogruCevap, s.aciklama || "", difficulty
      );
      return { id, soru: s.soru, secenekler: s.secenekler, dogruCevap: s.dogruCevap, aciklama: s.aciklama };
    });

    aiUsageKaydet(userId, "generate-questions");

    res.json({ sorular: kaydedilenler });
  } catch (err) {
    console.error("[ai/generate-questions]", err.message);
    res.status(503).json({ hata: "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen birkaç dakika sonra tekrar deneyin." });
  }
});

/* ---------------------------- FOTOĞRAFTAN SORU ÇÖZ ---------------------------- */

router.post("/solve-image", aiRateLimit, async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  const userId = req.header("X-User-Id");

  if (!imageBase64) {
    return res.status(400).json({ hata: "Görsel gönderilmedi." });
  }

  try {
    const metin = await aiProvider.generateWithImage({
      system: "Sen bir KPSS öğretmenisin. Sana bir soru fotoğrafı verilecek.",
      prompt: `Bu görseldeki çoktan seçmeli soruyu ve şıklarını oku, çöz. Yalnızca şu JSON formatında cevap ver:
{"soru": "...", "secenekler": {"A":"...","B":"...","C":"...","D":"...","E":"..."}, "dogruCevap": "A", "aciklama": "..."}
Görsel okunamıyorsa ya da soru net değilse "hata" alanına kısa açıklama yaz: {"hata": "..."}`,
      imageBase64,
      mimeType: mimeType || "image/jpeg"
    });

    const sonuc = guvenliJsonAyristir(metin);
    if (!sonuc) {
      return res.status(422).json({ hata: "Görseldeki soru anlaşılamadı, lütfen daha net bir fotoğraf deneyin." });
    }
    if (sonuc.hata) {
      return res.status(422).json({ hata: sonuc.hata });
    }

    aiUsageKaydet(userId, "solve-image");
    res.json(sonuc);
  } catch (err) {
    console.error("[ai/solve-image]", err.message);
    res.status(503).json({ hata: "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen birkaç dakika sonra tekrar deneyin." });
  }
});

/* ------------------------ KARMA TEST (Ana sayfa "Soru Çözmeye Başla") ------------------------ */
// Birden fazla ders/konu isteğini tek seferde işler, tek AI isteği hakkı harcanır.
router.post("/generate-mixed-test", aiRateLimit, async (req, res) => {
  const { istekler } = req.body; // [{subject, topic, difficulty, count}]
  const userId = req.header("X-User-Id");

  if (!Array.isArray(istekler) || istekler.length === 0) {
    return res.status(400).json({ hata: "istekler dizisi zorunludur." });
  }

  try {
    const tumSorular = [];

    for (const istek of istekler) {
      const { subject, topic, difficulty = "orta" } = istek;
      if (!subject || !topic) continue;
      const guvenliSayi = Math.max(1, Math.min(Number(istek.count) || 5, 20));

      let sorular = await soruUret({ subject, topic, difficulty, count: guvenliSayi });
      let gecerliSorular = sorular.filter(soruGecerliMi);

      if (gecerliSorular.length < guvenliSayi) {
        const eksik = guvenliSayi - gecerliSorular.length;
        const ekSorular = await soruUret({ subject, topic, difficulty, count: eksik });
        gecerliSorular = gecerliSorular.concat(ekSorular.filter(soruGecerliMi));
      }

      for (const s of gecerliSorular.slice(0, guvenliSayi)) {
        const id = nanoid();
        db.prepare(`INSERT INTO questions (id, subject, topic, question, options, correct_answer, explanation, difficulty, source, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL)`).run(
          id, subject, topic, s.soru, JSON.stringify(s.secenekler), s.dogruCevap, s.aciklama || "", difficulty
        );
        tumSorular.push({ id, subject, topic, soru: s.soru, secenekler: s.secenekler, dogruCevap: s.dogruCevap, aciklama: s.aciklama });
      }
    }

    aiUsageKaydet(userId, "generate-mixed-test");
    res.json({ sorular: tumSorular });
  } catch (err) {
    console.error("[ai/generate-mixed-test]", err.message);
    res.status(503).json({ hata: "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen birkaç dakika sonra tekrar deneyin." });
  }
});

module.exports = router;
