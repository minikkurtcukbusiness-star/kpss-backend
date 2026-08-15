/* ==========================================================================
   routes/currentAffairs.js
   GET  /api/current-affairs/today   → bugüne ait güncel bilgileri getirir
                                        (yoksa arama+AI ile üretip DB'ye yazar)
   POST /api/current-affairs/quiz    → "Bugünün Testini Çöz": güncel
                                        bilgilerden 10 soruluk özgün test üretir
   ========================================================================== */

const express = require("express");
const { nanoid } = require("nanoid");
const { searchWeb } = require("../services/webSearch");
const aiProvider = require("../services/aiProvider");
const { aiRateLimit } = require("../middleware/rateLimit");
const cache = require("../services/cache");
const db = require("../db/db");
const { CURRENT_AFFAIRS_CATEGORIES } = require("../config/sources");

const router = express.Router();

function bugunISO() {
  return new Date().toISOString().slice(0, 10);
}

function guvenliJsonAyristir(metin) {
  try {
    return JSON.parse(metin.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

// Özellik 7: Tarih kontrolü — kaynağın yayın tarihi bugünden çok eskiyse
// (ör. 30 günden fazla) "bugünün güncel bilgisi" olarak sunma.
function tarihGecerliMi(iso, maksGunOnce = 30) {
  if (!iso) return true; // tarih bilinmiyorsa reddetme, ama AI'ya belirtilecek
  const tarih = new Date(iso);
  if (isNaN(tarih.getTime())) return true;
  const farkGun = (Date.now() - tarih.getTime()) / (1000 * 60 * 60 * 24);
  return farkGun <= maksGunOnce;
}

async function gununGuncelBilgileriniUret() {
  const bugun = bugunISO();
  const cacheKey = `current-affairs:${bugun}`;
  const onbellek = cache.get(cacheKey);
  if (onbellek) return onbellek;

  // DB'de bugüne ait kayıt var mı?
  const mevcut = db.prepare("SELECT * FROM current_affairs WHERE published_at = ?").all(bugun);
  if (mevcut.length > 0) {
    const sonuc = mevcut.map(satirdanNesneyeCevir);
    cache.set(cacheKey, sonuc);
    return sonuc;
  }

  const uretilenler = [];

  // Maliyeti kontrol altında tutmak için kategori başına küçük bir arama yapılır.
  for (const kategori of CURRENT_AFFAIRS_CATEGORIES) {
    const sorgu = kategori.sorgu.replace("%TARIH%", bugun);
    const kaynaklar = await searchWeb(sorgu, { onlyTrusted: true, limit: 3 });
    const guncelKaynaklar = kaynaklar.filter(k => tarihGecerliMi(k.tarih));

    if (guncelKaynaklar.length === 0) continue;

    const kaynakMetni = guncelKaynaklar
      .map((k, i) => `[${i + 1}] ${k.baslik} (${k.kaynak}, ${k.tarih || "tarih belirtilmemiş"}) — ${k.icerikOzeti}`)
      .join("\n");

    try {
      const metin = await aiProvider.generate({
        system: `Sen KPSS öğrencisine güncel bilgi özetleyen bir eğitmensin. Cevabını SADECE JSON olarak ver.`,
        prompt: `Aşağıdaki "${kategori.ad}" kategorisindeki güncel kaynaklardan, KPSS öğrencisinin ezberleyebileceği KISA, sınav odaklı, gereksiz ayrıntıdan uzak 1-2 bilgi kartı çıkar. Eski veya belirsiz bilgi varsa dahil etme.
Kaynaklar:
${kaynakMetni}

Format:
[{"baslik": "...", "ozet": "... (en fazla 2-3 cümle)"}]`,
        jsonMode: true
      });

      const kartlar = guvenliJsonAyristir(metin) || [];
      for (const kart of kartlar) {
        if (!kart.baslik || !kart.ozet) continue;
        const id = nanoid();
        const enIyiKaynak = guncelKaynaklar[0];
        db.prepare(`INSERT INTO current_affairs (id, title, summary, category, published_at, source_name, source_url, content)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, kart.baslik, kart.ozet, kategori.ad, bugun, enIyiKaynak.kaynak, enIyiKaynak.url, kaynakMetni
        );
        for (const k of guncelKaynaklar) {
          db.prepare(`INSERT INTO sources (id, current_affairs_id, title, url, domain) VALUES (?, ?, ?, ?, ?)`).run(
            nanoid(), id, k.baslik, k.url, k.kaynak
          );
        }
        uretilenler.push({
          id, baslik: kart.baslik, ozet: kart.ozet, kategori: kategori.ad,
          tarih: bugun, kaynakAdi: enIyiKaynak.kaynak, kaynakUrl: enIyiKaynak.url
        });
      }
    } catch (err) {
      console.error(`[current-affairs] "${kategori.ad}" için AI hatası:`, err.message);
      // Bir kategori başarısız olursa diğerlerine devam et.
    }
  }

  cache.set(cacheKey, uretilenler);
  return uretilenler;
}

function satirdanNesneyeCevir(satir) {
  const kaynaklar = db.prepare("SELECT title, url, domain FROM sources WHERE current_affairs_id = ?").all(satir.id);
  return {
    id: satir.id,
    baslik: satir.title,
    ozet: satir.summary,
    kategori: satir.category,
    tarih: satir.published_at,
    kaynakAdi: satir.source_name,
    kaynakUrl: satir.source_url,
    tumKaynaklar: kaynaklar
  };
}

router.get("/today", async (req, res) => {
  try {
    const bilgiler = await gununGuncelBilgileriniUret();
    res.json({ tarih: bugunISO(), bilgiler });
  } catch (err) {
    console.error("[current-affairs/today]", err.message);
    res.status(503).json({ hata: "Güncel bilgi alınamadı." });
  }
});

router.post("/quiz", aiRateLimit, async (req, res) => {
  const userId = req.header("X-User-Id");
  try {
    const bilgiler = await gununGuncelBilgileriniUret();
    if (bilgiler.length === 0) {
      return res.status(503).json({ hata: "Bugün için yeterli güncel bilgi bulunamadı, lütfen daha sonra tekrar deneyin." });
    }

    const bilgiMetni = bilgiler
      .slice(0, 10)
      .map((b, i) => `${i + 1}. [${b.kategori}] ${b.baslik}: ${b.ozet} (Kaynak: ${b.kaynakAdi})`)
      .join("\n");

    const metin = await aiProvider.generate({
      system: "Sen KPSS güncel bilgiler testi hazırlayan bir soru yazarısın. Yalnızca JSON formatında cevap ver.",
      prompt: `Aşağıdaki güncel bilgilerden, her biri için 1 tane olmak üzere toplam ${Math.min(bilgiler.length, 10)} adet KPSS tarzı çoktan seçmeli soru üret.
Güncel bilgiler:
${bilgiMetni}

Format:
[{"soru": "...", "secenekler": {"A":"...","B":"...","C":"...","D":"...","E":"..."}, "dogruCevap": "A", "aciklama": "...", "kaynak": "..."}]`,
      jsonMode: true
    });

    const sorular = (guvenliJsonAyristir(metin) || []).filter(
      s => s.soru && s.secenekler && s.dogruCevap && Object.keys(s.secenekler).length >= 4
    );

    db.prepare("INSERT INTO ai_usage (id, user_id, islem, saglayici) VALUES (?, ?, 'current-affairs-quiz', ?)").run(
      nanoid(), userId || null, process.env.AI_PROVIDER || "gemini"
    );

    res.json({ tarih: bugunISO(), sorular });
  } catch (err) {
    console.error("[current-affairs/quiz]", err.message);
    res.status(503).json({ hata: "Bugünün testi oluşturulamadı. Lütfen birkaç dakika sonra tekrar deneyin." });
  }
});

module.exports = router;
