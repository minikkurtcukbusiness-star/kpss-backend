/* ==========================================================================
   routes/ai.js
   KPSS 2026 - BASİT 20 SORULUK AI SİSTEMİ

   Bu sürüm:
   - Gemini kullanmaz
   - Veritabanından soru çekmez
   - Soru havuzu kullanmaz
   - Tek OpenRouter isteği gönderir
   - Maksimum 20 soru üretir
   - Frontend'e direkt soruları gönderir
   ========================================================================== */

const express = require("express");

const router = express.Router();

/* --------------------------------------------------------------------------
   YARDIMCI: JSON TEMİZLE
   -------------------------------------------------------------------------- */

function temizJson(metin) {
  if (!metin || typeof metin !== "string") {
    return null;
  }

  let temiz = metin.trim();

  // Markdown kod bloğu varsa kaldır
  temiz = temiz
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // İlk { veya [ karakterinden başlat
  const ilkObje = temiz.indexOf("{");
  const ilkDizi = temiz.indexOf("[");

  let baslangic = -1;

  if (ilkObje === -1) {
    baslangic = ilkDizi;
  } else if (ilkDizi === -1) {
    baslangic = ilkObje;
  } else {
    baslangic = Math.min(ilkObje, ilkDizi);
  }

  if (baslangic > 0) {
    temiz = temiz.substring(baslangic);
  }

  // Son JSON karakterinden sonrasını temizle
  const sonObje = temiz.lastIndexOf("}");
  const sonDizi = temiz.lastIndexOf("]");

  const bitis = Math.max(sonObje, sonDizi);

  if (bitis !== -1 && bitis < temiz.length - 1) {
    temiz = temiz.substring(0, bitis + 1);
  }

  try {
    return JSON.parse(temiz);
  } catch (e) {
    console.error("[JSON PARSE HATASI]", e.message);
    console.error("[MODEL CEVABI]", temiz.substring(0, 2000));

    return null;
  }
}

/* --------------------------------------------------------------------------
   SORU KONTROLÜ
   -------------------------------------------------------------------------- */

function soruGecerliMi(soru) {
  if (!soru || typeof soru !== "object") {
    return false;
  }

  if (
    !soru.soru ||
    typeof soru.soru !== "string" ||
    soru.soru.trim().length < 5
  ) {
    return false;
  }

  if (
    !soru.secenekler ||
    typeof soru.secenekler !== "object"
  ) {
    return false;
  }

  const harfler = ["A", "B", "C", "D", "E"];

  for (const harf of harfler) {
    if (
      !soru.secenekler[harf] ||
      typeof soru.secenekler[harf] !== "string"
    ) {
      return false;
    }
  }

  if (
    !harfler.includes(
      String(soru.dogruCevap || "").toUpperCase()
    )
  ) {
    return false;
  }

  return true;
}

/* --------------------------------------------------------------------------
   OPENROUTER'DAN 20 SORU ÜRET
   -------------------------------------------------------------------------- */

async function sorulariUret(istekler) {

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY Railway Variables bölümünde bulunamadı."
    );
  }

  /*
     Frontend'den gelen ders/konu listesini güvenli şekilde 20 soruya sınırla.
  */

  let kalan = 20;

  const konular = [];

  for (const istek of istekler) {

    if (!istek || !istek.subject) {
      continue;
    }

    if (kalan <= 0) {
      break;
    }

    const konu = istek.topic || "Genel";

    let sayi = Number(istek.count);

    if (!Number.isFinite(sayi) || sayi <= 0) {
      sayi = 1;
    }

    sayi = Math.floor(sayi);

    if (sayi > kalan) {
      sayi = kalan;
    }

    konular.push({
      subject: String(istek.subject),
      topic: String(konu),
      difficulty: String(istek.difficulty || "orta"),
      count: sayi
    });

    kalan -= sayi;
  }

  /*
     Frontend 80 istese bile maksimum 20.
     Eğer frontend yanlışlıkla sayı göndermezse yine 20'ye tamamla.
  */

  if (konular.length === 0) {
    konular.push({
      subject: "Türkçe",
      topic: "Genel Türkçe",
      difficulty: "orta",
      count: 20
    });
  }

  const toplamIstenen = konular.reduce(
    (toplam, konu) => toplam + konu.count,
    0
  );

  const konuMetni = konular
    .map(
      (k, index) =>
        `${index + 1}. Ders: ${k.subject} | Konu: ${k.topic} | Zorluk: ${k.difficulty} | Soru: ${k.count}`
    )
    .join("\n");

  /* ----------------------------------------------------------------------
     PROMPT
     ---------------------------------------------------------------------- */

  const prompt = `
Sen Türkiye'deki 2026 KPSS Ortaöğretim sınavına hazırlanan öğrenci için
çok kaliteli test soruları hazırlayan uzman bir KPSS öğretmenisin.

Aşağıdaki ders ve konulara göre TAM OLARAK ${toplamIstenen} adet soru üret.

DERS VE KONU DAĞILIMI:

${konuMetni}

KURALLAR:

1. Sorular KPSS Ortaöğretim seviyesinde olsun.

2. Her soru 5 seçenekli olsun:
A, B, C, D, E.

3. Her soruda yalnızca BİR doğru cevap olsun.

4. Doğru cevap "A", "B", "C", "D" veya "E" şeklinde yazılmalı.

5. Sorular özgün olsun.

6. Sorular açık ve anlaşılır Türkçe ile yazılsın.

7. Şıklar mantıklı çeldiriciler içersin.

8. Aynı soruyu veya çok benzer soruları tekrar etme.

9. Tarih, vatandaşlık ve coğrafya sorularında bilgi hatası yapma.

10. Matematik sorularında hesaplamaları kontrol et.

11. Her sorunun kısa ve öğretici bir açıklaması olsun.

12. Güncel bilgi gerektiren bir soru oluşturuyorsan kesin olmayan bilgileri
uydurma.

13. Kullanıcıya soru dışında hiçbir açıklama yazma.

14. SADECE JSON döndür.

ÇOK ÖNEMLİ:

Cevabın aşağıdaki JSON formatında olmalı:

{
  "sorular": [
    {
      "subject": "Türkçe",
      "topic": "Sözcükte Anlam",
      "soru": "Soru metni",
      "secenekler": {
        "A": "A seçeneği",
        "B": "B seçeneği",
        "C": "C seçeneği",
        "D": "D seçeneği",
        "E": "E seçeneği"
      },
      "dogruCevap": "A",
      "aciklama": "Doğru cevabın kısa açıklaması"
    }
  ]
}

SADECE JSON.
Markdown kullanma.
\`\`\` kullanma.
JSON dışında hiçbir şey yazma.
`;

  /* ----------------------------------------------------------------------
     OPENROUTER İSTEĞİ
     ---------------------------------------------------------------------- */

  const controller = new AbortController();

  /*
     110 saniye timeout.
     Tek AI isteği olduğu için önceki sisteme göre çok daha az riskli.
  */

  const timeout = setTimeout(() => {
    controller.abort();
  }, 110000);

  try {

    const model =
      process.env.OPENROUTER_MODEL ||
      "openrouter/free";

    console.log(
      `[OpenRouter] ${toplamIstenen} soru isteniyor. Model: ${model}`
    );

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",

          "HTTP-Referer":
            process.env.APP_URL ||
            "https://kpss-backend-production.up.railway.app",

          "X-Title": "KPSS-2026"
        },

        body: JSON.stringify({
          model: model,

          messages: [
            {
              role: "system",
              content:
                "Sen KPSS Ortaöğretim için kaliteli, özgün ve doğru test soruları hazırlayan uzman bir öğretmensin. Yalnızca istenen JSON formatında cevap ver."
            },
            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0.4,

          /*
             20 soru için yeterli alan.
          */
          max_tokens: 10000
        }),

        signal: controller.signal
      }
    );

    const responseText = await response.text();

    if (!response.ok) {

      console.error(
        "[OpenRouter API HATASI]",
        response.status,
        responseText
      );

      throw new Error(
        `OpenRouter API ${response.status}: ${responseText}`
      );
    }

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(
        "OpenRouter cevabı JSON olarak okunamadı."
      );
    }

    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) {
      console.error(
        "[OpenRouter BOŞ CEVAP]",
        JSON.stringify(data).substring(0, 3000)
      );

      throw new Error(
        "OpenRouter boş cevap döndürdü."
      );
    }

    console.log(
      `[OpenRouter] Cevap alındı. Uzunluk: ${content.length}`
    );

    const sonuc = temizJson(content);

    if (!sonuc) {
      throw new Error(
        "Yapay zekâ geçerli JSON üretmedi."
      );
    }

    let sorular = [];

    if (Array.isArray(sonuc)) {
      sorular = sonuc;
    } else if (Array.isArray(sonuc.sorular)) {
      sorular = sonuc.sorular;
    }

    const gecerliSorular = sorular
      .filter(soruGecerliMi)
      .slice(0, 20)
      .map((soru, index) => ({
        id:
          `ai-${Date.now()}-${index}`,

        subject:
          soru.subject || "KPSS",

        topic:
          soru.topic || "Genel",

        soru:
          soru.soru.trim(),

        secenekler: {
          A: String(soru.secenekler.A),
          B: String(soru.secenekler.B),
          C: String(soru.secenekler.C),
          D: String(soru.secenekler.D),
          E: String(soru.secenekler.E)
        },

        dogruCevap:
          String(soru.dogruCevap).toUpperCase(),

        aciklama:
          String(soru.aciklama || "")
      }));

    if (gecerliSorular.length === 0) {
      throw new Error(
        "Yapay zekâdan geçerli soru alınamadı."
      );
    }

    console.log(
      `[OpenRouter] ${gecerliSorular.length} geçerli soru hazır.`
    );

    return gecerliSorular;

  } finally {

    clearTimeout(timeout);

  }
}

/* ==========================================================================
   KARMA TEST

   Frontend:
   POST /api/ai/generate-mixed-test

   Body:
   {
     "istekler": [
       {
         "subject": "Türkçe",
         "topic": "Sözcükte Anlam",
         "difficulty": "orta",
         "count": 4
       }
     ]
   }

   Toplam soru sayısı HER ZAMAN maksimum 20.
   ========================================================================== */

router.post("/generate-mixed-test", async (req, res) => {

  try {

    const { istekler } = req.body || {};

    if (
      !Array.isArray(istekler) ||
      istekler.length === 0
    ) {
      return res.status(400).json({
        hata: "Ders ve konu bilgisi gönderilmedi."
      });
    }

    console.log(
      "[ai/generate-mixed-test] Test hazırlanıyor..."
    );

    const sorular =
      await sorulariUret(istekler);

    if (!sorular || sorular.length === 0) {

      return res.status(503).json({
        hata:
          "Yapay zekâ soru oluşturamadı. Lütfen tekrar deneyin."
      });
    }

    console.log(
      `[ai/generate-mixed-test] ${sorular.length} soru başarıyla hazırlandı.`
    );

    return res.json({
      ok: true,
      sorular: sorular
    });

  } catch (err) {

    if (err.name === "AbortError") {

      console.error(
        "[ai/generate-mixed-test] İstek zaman aşımına uğradı."
      );

      return res.status(504).json({
        hata:
          "Soru oluşturma işlemi zaman aşımına uğradı. Lütfen tekrar deneyin."
      });
    }

    console.error(
      "[ai/generate-mixed-test]",
      err.message
    );

    return res.status(503).json({
      hata:
        "Yapay zekâ servisine ulaşılamadı. Lütfen birkaç dakika sonra tekrar deneyin."
    });
  }

});

/* ==========================================================================
   TEST
   ========================================================================== */

router.get("/health", (req, res) => {

  res.json({
    ok: true,
    servis: "KPSS AI",
    sistem: "OpenRouter",
    maksimumSoru: 20
  });

});

/* --------------------------------------------------------------------------
   EXPORT
   -------------------------------------------------------------------------- */

module.exports = router;
