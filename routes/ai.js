const express = require("express");

const router = express.Router();

/* =========================================================
   AYARLAR
   ========================================================= */

const MAX_SORU = 5;
const TIMEOUT_MS = 110000;


/* =========================================================
   JSON TEMİZLE
   ========================================================= */

function temizJson(metin) {
  if (!metin || typeof metin !== "string") {
    return null;
  }

  let temiz = metin.trim();

  temiz = temiz
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

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
    console.error("[MODEL CEVABI]", temiz.substring(0, 3000));
    return null;
  }
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

  const dogru = String(
    soru.dogruCevap || ""
  ).toUpperCase();

  if (!harfler.includes(dogru)) {
    return false;
  }

  return true;
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

  /*
     Frontend 80 soru gönderse bile
     biz sadece 5 soru ürettiriyoruz.
  */

  const konular = [];

  let kalan = MAX_SORU;

  for (const istek of istekler) {

    if (!istek || !istek.subject) {
      continue;
    }

    if (kalan <= 0) {
      break;
    }

    const subject = String(istek.subject);
    const topic = String(istek.topic || "Genel");
    const difficulty = String(
      istek.difficulty || "orta"
    );

    let sayi = Number(istek.count);

    if (!Number.isFinite(sayi) || sayi <= 0) {
      sayi = 1;
    }

    sayi = Math.floor(sayi);

    if (sayi > kalan) {
      sayi = kalan;
    }

    konular.push({
      subject,
      topic,
      difficulty,
      count: sayi
    });

    kalan -= sayi;
  }

  /*
     Eğer frontend düzgün veri göndermediyse
     varsayılan olarak Türkçe'den 5 soru üret.
  */

  if (konular.length === 0) {
    konular.push({
      subject: "Türkçe",
      topic: "Genel",
      difficulty: "orta",
      count: MAX_SORU
    });
  }

  /*
     Eğer frontend örneğin 80 soru gönderirse
     ama ilk dersin count'u 80 ise yukarıdaki
     sınır nedeniyle sadece 5 kalır.
  */

  let toplamIstenen = konular.reduce(
    (toplam, konu) => toplam + konu.count,
    0
  );

  if (toplamIstenen > MAX_SORU) {
    toplamIstenen = MAX_SORU;
  }

  const konuMetni = konular
    .map((k, index) => {
      return (
        `${index + 1}. Ders: ${k.subject}\n` +
        `Konu: ${k.topic}\n` +
        `Zorluk: ${k.difficulty}\n` +
        `Soru sayısı: ${k.count}`
      );
    })
    .join("\n\n");


  /* =======================================================
     PROMPT
     ======================================================= */

  const prompt = `
Sen Türkiye'deki 2026 KPSS Ortaöğretim sınavına
hazırlanan öğrenciler için soru hazırlayan uzman
bir KPSS öğretmenisin.

Aşağıdaki ders ve konulara göre TAM OLARAK
${toplamIstenen} adet soru üret.

DERSLER:

${konuMetni}

KURALLAR:

1. Sorular KPSS Ortaöğretim seviyesinde olsun.

2. Her soru 5 seçenekli olsun:
A, B, C, D, E.

3. Her soruda yalnızca BİR doğru cevap olsun.

4. Doğru cevap yalnızca A, B, C, D veya E olsun.

5. Sorular özgün olsun.

6. Sorular açık ve anlaşılır Türkçe ile yazılsın.

7. Şıklar mantıklı çeldiriciler içersin.

8. Aynı soruyu tekrar etme.

9. Tarih, vatandaşlık ve coğrafya sorularında
bilgi hatası yapma.

10. Matematik sorularında hesaplamaları kontrol et.

11. Her sorunun kısa bir açıklaması olsun.

12. Kesin olmayan güncel bilgileri uydurma.

13. Soru dışında hiçbir açıklama yazma.

14. SADECE JSON döndür.

JSON FORMATI:

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
Kod bloğu kullanma.
JSON dışında hiçbir şey yazma.
`;


  /* =======================================================
     OPENROUTER
     ======================================================= */

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);


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

          /*
             Türkçe karakter yok.
             ByteString hatasını önlemek için.
          */

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
                "Sen KPSS Ortaogretim icin kaliteli, ozgun ve dogru test sorulari hazirlayan uzman bir ogretmensin. Yalnizca istenen JSON formatinda cevap ver."
            },

            {
              role: "user",
              content: prompt
            }
          ],

          temperature: 0.3,

          /*
             5 soru için fazlasıyla yeterli.
          */

          max_tokens: 4000

        }),

        signal: controller.signal
      }
    );


    const responseText = await response.text();


    /* =====================================================
       API HATASI
       ===================================================== */

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


    /* =====================================================
       JSON CEVABI
       ===================================================== */

    let data;

    try {

      data = JSON.parse(responseText);

    } catch (e) {

      throw new Error(
        "OpenRouter cevabi JSON olarak okunamadi."
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
        "[OpenRouter BOS CEVAP]",
        JSON.stringify(data).substring(0, 3000)
      );

      throw new Error(
        "OpenRouter bos cevap dondurdu."
      );
    }


    console.log(
      `[OpenRouter] Cevap alindi. Uzunluk: ${content.length}`
    );


    /* =====================================================
       JSON'A ÇEVİR
       ===================================================== */

    const sonuc = temizJson(content);

    if (!sonuc) {

      throw new Error(
        "Yapay zeka gecerli JSON uretmedi."
      );
    }


    let sorular = [];


    if (Array.isArray(sonuc)) {

      sorular = sonuc;

    } else if (Array.isArray(sonuc.sorular)) {

      sorular = sonuc.sorular;

    }


    /* =====================================================
       SORULARI TEMİZLE
       ===================================================== */

    const gecerliSorular = sorular
      .filter(soruGecerliMi)
      .slice(0, MAX_SORU)
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
          String(
            soru.dogruCevap
          ).toUpperCase(),

        aciklama:
          String(
            soru.aciklama || ""
          )

      }));


    if (gecerliSorular.length === 0) {

      throw new Error(
        "Yapay zekadan gecerli soru alinamadi."
      );
    }


    console.log(
      `[OpenRouter] ${gecerliSorular.length} soru hazir.`
    );


    return gecerliSorular;

  } finally {

    clearTimeout(timeout);

  }
}


/* =========================================================
   KARMA TEST
   POST /api/ai/generate-mixed-test
   ========================================================= */

router.post(
  "/generate-mixed-test",
  async (req, res) => {

    try {

      const { istekler } =
        req.body || {};


      if (
        !Array.isArray(istekler) ||
        istekler.length === 0
      ) {

        return res.status(400).json({

          hata:
            "Ders ve konu bilgisi gonderilmedi."

        });

      }


      console.log(
        "[ai/generate-mixed-test] Test hazirlaniyor..."
      );


      const sorular =
        await sorulariUret(
          istekler
        );


      if (
        !sorular ||
        sorular.length === 0
      ) {

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

        sorular: sorular

      });


    } catch (err) {


      /* ================================================
         TIMEOUT
         ================================================ */

      if (
        err.name === "AbortError"
      ) {

        console.error(
          "[ai/generate-mixed-test] Istek zaman asimina ugradi."
        );


        return res.status(504).json({

          hata:
            "Soru olusturma islemi zaman asimina ugradi. Lutfen tekrar deneyin."

        });

      }


      /* ================================================
         DIGER HATALAR
         ================================================ */

      console.error(
        "[ai/generate-mixed-test]",
        err.message
      );


      return res.status(503).json({

        hata:
          "Yapay zeka servisine ulasilamadi. Lutfen tekrar deneyin."

      });

    }

  }
);


/* =========================================================
   HEALTH
   ========================================================= */

router.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      servis: "KPSS AI",

      sistem: "OpenRouter",

      maksimumSoru: MAX_SORU

    });

  }
);


/* =========================================================
   EXPORT
   ========================================================= */

module.exports = router;
