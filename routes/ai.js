const express = require("express");

const router = express.Router();

const MAX_SORU = 5;
const TIMEOUT_MS = 110000;
const MAX_JSON_DENEME = 2;

/* =========================================================
   MODEL CEVABINDAN JSON AYIKLA
   ========================================================= */
function temizJson(metin) {
  if (!metin || typeof metin !== "string") {
    return null;
  }

  let temiz = metin.trim();

  // Markdown kod bloğunu kaldır.
  temiz = temiz
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Önce cevap zaten saf JSON ise doğrudan dene.
  try {
    return JSON.parse(temiz);
  } catch (_) {
    // Aşağıda daha sağlam şekilde JSON nesnesini bulacağız.
  }

  // Model JSON'dan önce/sonra açıklama yazmışsa ilk gerçek JSON
  // nesnesini dengeli parantezlerle bul. String içindeki { } karakterlerini
  // dikkate alıyoruz.
  const baslangic = temiz.indexOf("{");

  if (baslangic === -1) {
    console.error("[JSON PARSE] JSON nesnesi bulunamadı.");
    console.error("[MODEL CEVABI]", temiz.substring(0, 3000));
    return null;
  }

  let derinlik = 0;
  let stringIcinde = false;
  let escape = false;

  for (let i = baslangic; i < temiz.length; i++) {
    const karakter = temiz[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (karakter === "\\" && stringIcinde) {
      escape = true;
      continue;
    }

    if (karakter === '"') {
      stringIcinde = !stringIcinde;
      continue;
    }

    if (stringIcinde) {
      continue;
    }

    if (karakter === "{") {
      derinlik++;
    } else if (karakter === "}") {
      derinlik--;

      if (derinlik === 0) {
        const jsonParcasi = temiz.substring(baslangic, i + 1);

        try {
          return JSON.parse(jsonParcasi);
        } catch (e) {
          console.error("[JSON PARSE HATASI]", e.message);
          console.error("[MODEL CEVABI]", temiz.substring(0, 3000));
          return null;
        }
      }
    }
  }

  console.error("[JSON PARSE] JSON nesnesi tamamlanamadı.");
  console.error("[MODEL CEVABI]", temiz.substring(0, 3000));
  return null;
}

/* =========================================================
   SORU KONTROLÜ
   ========================================================= */
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

  if (!soru.secenekler || typeof soru.secenekler !== "object") {
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

  const dogru = String(soru.dogruCevap || "").toUpperCase();

  return harfler.includes(dogru);
}

/* =========================================================
   OPENROUTER İSTEĞİ
   ========================================================= */
async function openRouterSoruIste({ apiKey, model, prompt, signal }) {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.APP_URL ||
          "https://kpss-backend-production.up.railway.app",
        "X-Title": "KPSS-2026"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Sen KPSS Ortaogretim icin kaliteli, ozgun ve dogru test sorulari hazirlayan uzman bir ogretmensin. Cevabin yalnizca gecerli JSON nesnesi olmalidir. JSON disinda tek bir karakter bile yazma."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 6000,
        response_format: {
          type: "json_object"
        }
      }),
      signal
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    console.error(
      "[OpenRouter API HATASI]",
      response.status,
      responseText.substring(0, 3000)
    );

    throw new Error(
      `OpenRouter API ${response.status}: ${responseText}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch (_) {
    throw new Error("OpenRouter cevabi JSON olarak okunamadi.");
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error(
      "[OpenRouter BOS CEVAP]",
      JSON.stringify(data).substring(0, 3000)
    );

    throw new Error("OpenRouter bos cevap dondurdu.");
  }

  return content;
}

/* =========================================================
   OPENROUTER'DAN SORU ÜRET
   ========================================================= */
async function sorulariUret(istekler) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY Railway Variables bölümünde bulunamadı."
    );
  }

  const konular = [];
  let kalan = MAX_SORU;

  for (const istek of istekler) {
    if (!istek || !istek.subject || kalan <= 0) {
      continue;
    }

    const subject = String(istek.subject);
    const topic = String(istek.topic || "Genel");
    const difficulty = String(istek.difficulty || "orta");

    let sayi = Number(istek.count);

    if (!Number.isFinite(sayi) || sayi <= 0) {
      sayi = 1;
    }

    sayi = Math.floor(sayi);
    sayi = Math.min(sayi, kalan);

    konular.push({
      subject,
      topic,
      difficulty,
      count: sayi
    });

    kalan -= sayi;
  }

  if (konular.length === 0) {
    konular.push({
      subject: "Türkçe",
      topic: "Genel",
      difficulty: "orta",
      count: MAX_SORU
    });
  }

  const toplamIstenen = Math.min(
    MAX_SORU,
    konular.reduce((toplam, konu) => toplam + konu.count, 0)
  );

  const konuMetni = konular
    .map(
      (k, index) =>
        `${index + 1}. Ders: ${k.subject}\n` +
        `Konu: ${k.topic}\n` +
        `Zorluk: ${k.difficulty}\n` +
        `Soru sayısı: ${k.count}`
    )
    .join("\n\n");

  const prompt = `
Sen Türkiye'deki 2026 KPSS Ortaöğretim sınavına hazırlanan öğrenciler için soru hazırlayan uzman bir KPSS öğretmenisin.

Aşağıdaki ders ve konulara göre TAM OLARAK ${toplamIstenen} adet soru üret.

DERSLER:
${konuMetni}

KURALLAR:
1. Sorular KPSS Ortaöğretim seviyesinde olsun.
2. Her soru 5 seçenekli olsun: A, B, C, D, E.
3. Her soruda yalnızca BİR doğru cevap olsun.
4. dogruCevap değeri yalnızca A, B, C, D veya E olsun.
5. Sorular özgün olsun.
6. Sorular açık ve anlaşılır Türkçe ile yazılsın.
7. Şıklar mantıklı çeldiriciler içersin.
8. Aynı soruyu tekrar etme.
9. Tarih, vatandaşlık ve coğrafya sorularında bilgi hatası yapma.
10. Matematik sorularında hesaplamaları kontrol et.
11. Her sorunun kısa bir açıklaması olsun.
12. Kesin olmayan güncel bilgileri uydurma.
13. JSON içindeki tüm metinler geçerli JSON stringleri olmalıdır.
14. Soru metinlerinde ve açıklamalarda çift tırnak kullanman gerekiyorsa \\" şeklinde escape et.
15. JSON dışında hiçbir açıklama yazma.
16. Markdown kullanma.
17. Kod bloğu kullanma.

SADECE aşağıdaki yapıda geçerli JSON döndür:
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
`;

  const model = process.env.OPENROUTER_MODEL || "openrouter/free";

  console.log(
    `[OpenRouter] ${toplamIstenen} soru isteniyor. Model: ${model}`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let sonHata = null;

    for (let deneme = 1; deneme <= MAX_JSON_DENEME; deneme++) {
      try {
        console.log(
          `[OpenRouter] JSON üretim denemesi: ${deneme}/${MAX_JSON_DENEME}`
        );

        const content = await openRouterSoruIste({
          apiKey,
          model,
          prompt,
          signal: controller.signal
        });

        console.log(
          `[OpenRouter] Cevap alindi. Uzunluk: ${content.length}`
        );

        const sonuc = temizJson(content);

        if (!sonuc) {
          sonHata = new Error("Yapay zeka gecerli JSON uretmedi.");
          continue;
        }

        let sorular = [];

        if (Array.isArray(sonuc)) {
          sorular = sonuc;
        } else if (Array.isArray(sonuc.sorular)) {
          sorular = sonuc.sorular;
        }

        const gecerliSorular = sorular
          .filter(soruGecerliMi)
          .slice(0, MAX_SORU)
          .map((soru, index) => ({
            id: `ai-${Date.now()}-${index}`,
            subject: soru.subject || "KPSS",
            topic: soru.topic || "Genel",
            soru: soru.soru.trim(),
            secenekler: {
              A: String(soru.secenekler.A),
              B: String(soru.secenekler.B),
              C: String(soru.secenekler.C),
              D: String(soru.secenekler.D),
              E: String(soru.secenekler.E)
            },
            dogruCevap: String(soru.dogruCevap).toUpperCase(),
            aciklama: String(soru.aciklama || "")
          }));

        if (gecerliSorular.length === 0) {
          sonHata = new Error(
            "Yapay zekadan gecerli soru alinamadi."
          );
          continue;
        }

        console.log(
          `[OpenRouter] ${gecerliSorular.length} soru hazir.`
        );

        return gecerliSorular;
      } catch (err) {
        if (err.name === "AbortError") {
          throw err;
        }

        sonHata = err;
        console.error(
          `[OpenRouter] Deneme ${deneme} basarisiz:`,
          err.message
        );
      }
    }

    throw sonHata || new Error("Yapay zeka gecerli JSON uretmedi.");
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   KARMA TEST
   POST /api/ai/generate-mixed-test
   ========================================================= */
router.post("/generate-mixed-test", async (req, res) => {
  try {
    const { istekler } = req.body || {};

    if (!Array.isArray(istekler) || istekler.length === 0) {
      return res.status(400).json({
        hata: "Ders ve konu bilgisi gonderilmedi."
      });
    }

    console.log(
      "[ai/generate-mixed-test] Test hazirlaniyor..."
    );

    const sorular = await sorulariUret(istekler);

    if (!sorular || sorular.length === 0) {
      return res.status(503).json({
        hata:
          "Yapay zeka soru olusturamadi. Lutfen tekrar deneyin."
      });
    }

    console.log(
      `[ai/generate-mixed-test] ${sorular.length} soru basariyla hazirlandi.`
    );

    return res.json({
      ok: true,
      sorular
    });
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(
        "[ai/generate-mixed-test] Istek zaman asimina ugradi."
      );

      return res.status(504).json({
        hata:
          "Soru olusturma islemi zaman asimina ugradi. Lutfen tekrar deneyin."
      });
    }

    console.error(
      "[ai/generate-mixed-test]",
      err.message
    );

    return res.status(503).json({
      hata:
        "Yapay zeka servisine ulasilamadi. Lutfen tekrar deneyin."
    });
  }
});

/* =========================================================
   HEALTH
   ========================================================= */
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    servis: "KPSS AI",
    sistem: "OpenRouter",
    maksimumSoru: MAX_SORU
  });
});

module.exports = router;
