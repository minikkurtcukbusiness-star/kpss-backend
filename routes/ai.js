/* ==========================================================================
   routes/ai.js
   - POST /api/ai/teacher
      → AI Öğretmen (gerekirse web aramasıyla desteklenir)

   - POST /api/ai/generate-questions
      → Konu bazlı özgün soru üretimi + kalite kontrolü

   - POST /api/ai/solve-image
      → Fotoğraftan soru çözme

   - POST /api/ai/generate-mixed-test
      → VERİTABANINDAN KARMA TEST
      → AI KULLANMAZ
   ========================================================================== */

const express = require("express");
const { nanoid } = require("nanoid");
const aiProvider = require("../services/aiProvider");
const { searchWeb } = require("../services/webSearch");
const { aiRateLimit } = require("../middleware/rateLimit");
const db = require("../db/db");

const router = express.Router();

/* ==========================================================================
   SINAV SİSTEM TALİMATI
   ========================================================================== */

const SINAV_SISTEM_TALIMATI = `
Sen 2026 KPSS Ortaöğretim sınavına hazırlanan bir öğrenciye yardımcı olan,
uzman bir KPSS öğretmenisin.

- Genel bir sohbet botu gibi davranma.
- Her zaman KPSS sınavı bağlamında, öz ve anlaşılır cevap ver.
- Cevaplarını Türkçe ver.
- Emin olmadığın veya doğrulayamadığın güncel bir bilgi varsa bunu açıkça belirt,
  uydurma.
- Sana kaynak metinleri verilmişse cevabını öncelikle bu kaynaklara dayandır.
`;

/* ==========================================================================
   GÜNCEL BİLGİ GEREKİYOR MU?
   ========================================================================== */

function guncelBilgiGerekiyorMu(soru) {

  const anahtarKelimeler = [
    "güncel",
    "şu an",
    "şu anda",
    "kim",
    "2026",
    "2025",
    "bu yıl",
    "son",
    "yeni",
    "değişti",
    "değişiklik",
    "atandı",
    "seçildi",
    "kazandı"
  ];

  const kucuk =
    soru.toLocaleLowerCase("tr");

  return anahtarKelimeler.some(
    k => kucuk.includes(k)
  );
}

/* ==========================================================================
   AI KULLANIM KAYDI
   ========================================================================== */

function aiUsageKaydet(userId, islem) {

  db.prepare(
    "INSERT INTO ai_usage (id, user_id, islem, saglayici) VALUES (?, ?, ?, ?)"
  ).run(
    nanoid(),
    userId || null,
    islem,
    process.env.AI_PROVIDER || "gemini"
  );
}

/* ==========================================================================
   GÜVENLİ JSON AYRIŞTIRICI
   ========================================================================== */

function guvenliJsonAyristir(metin) {

  try {

    const temiz =
      metin
        .replace(/```json|```/g, "")
        .trim();

    return JSON.parse(temiz);

  } catch {

    return null;
  }
}

/* ==========================================================================
   AI ÖĞRETMEN
   ========================================================================== */

router.post(
  "/teacher",
  aiRateLimit,
  async (req, res) => {

    const { soru } = req.body;
    const userId =
      req.header("X-User-Id");

    if (
      !soru ||
      !soru.trim()
    ) {

      return res.status(400).json({
        hata: "Soru boş olamaz."
      });
    }

    try {

      let kaynaklar = [];
      let kaynakMetni = "";

      /*
       * Güncel bilgi gerekiyorsa web araması yap.
       */

      if (
        guncelBilgiGerekiyorMu(soru)
      ) {

        kaynaklar =
          await searchWeb(
            soru,
            {
              onlyTrusted: true,
              limit: 5
            }
          );

        if (
          kaynaklar.length > 0
        ) {

          kaynakMetni =
            "\n\nAşağıdaki güncel kaynakları dikkate alarak cevap ver:\n" +
            kaynaklar
              .map(
                (k, i) =>
                  `[${i + 1}] ${k.baslik} (${k.kaynak}) — ${k.icerikOzeti}`
              )
              .join("\n");
        }
      }

      const cevapMetni =
        await aiProvider.generate({

          system:
            SINAV_SISTEM_TALIMATI,

          prompt:
            `Öğrenci sorusu: "${soru}"` +
            kaynakMetni +
            `

Kısa, anlaşılır ve KPSS odaklı cevap ver.

Uygunsa şu başlıkları kullan:

📌 KPSS'de önemli
⚠ Karıştırma
🧠 Ezberle
`
        });

      aiUsageKaydet(
        userId,
        "teacher"
      );

      res.json({

        cevap:
          cevapMetni,

        kaynaklar:
          kaynaklar.map(k => ({
            baslik: k.baslik,
            url: k.url,
            kaynak: k.kaynak,
            tarih: k.tarih
          })),

        belirsiz:
          kaynaklar.length === 0 &&
          guncelBilgiGerekiyorMu(soru)
      });

    } catch (err) {

      console.error(
        "[ai/teacher]",
        err.message
      );

      res.status(503).json({

        hata:
          "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen tekrar deneyin."

      });
    }
  }
);

/* ==========================================================================
   AI SORU ÜRETME
   ========================================================================== */

async function soruUret({
  subject,
  topic,
  difficulty,
  count
}) {

  const prompt = `
KPSS Ortaöğretim seviyesinde,
"${subject}" dersinin "${topic}" konusunda,
"${difficulty}" zorlukta,
TAMAMEN ÖZGÜN ${count} adet çoktan seçmeli soru üret.

Kurallar:

- Her sorunun tek bir doğru cevabı olmalı.
- Çeldiriciler mantıklı ve konuyla ilgili olmalı.
- Telif hakkı olan yayınlardan doğrudan kopya yapma.
- Kendi cümlelerinle özgün soru yaz.
- Yalnızca aşağıdaki JSON formatında cevap ver.
- Başka hiçbir açıklama ekleme.

[
  {
    "soru": "...",
    "secenekler": {
      "A": "...",
      "B": "...",
      "C": "...",
      "D": "...",
      "E": "..."
    },
    "dogruCevap": "A",
    "aciklama": "..."
  }
]
`;

  const metin =
    await aiProvider.generate({

      system:
        "Sen özgün KPSS soruları hazırlayan bir soru yazarısın. Yalnızca istenen JSON formatında cevap ver.",

      prompt,

      jsonMode: true
    });

  const sorular =
    guvenliJsonAyristir(metin);

  return Array.isArray(sorular)
    ? sorular
    : [];
}

/* ==========================================================================
   SORU KALİTE KONTROLÜ
   ========================================================================== */

function soruGecerliMi(s) {

  if (
    !s ||
    typeof s !== "object"
  ) {
    return false;
  }

  if (
    !s.soru ||
    typeof s.soru !== "string" ||
    s.soru.length < 8
  ) {
    return false;
  }

  if (
    !s.secenekler ||
    typeof s.secenekler !== "object"
  ) {
    return false;
  }

  const anahtarlar =
    Object.keys(
      s.secenekler
    );

  if (
    !["A", "B", "C", "D", "E"]
      .every(
        h => anahtarlar.includes(h)
      )
  ) {
    return false;
  }

  if (
    !s.dogruCevap ||
    !["A", "B", "C", "D", "E"]
      .includes(s.dogruCevap)
  ) {
    return false;
  }

  const degerler =
    Object.values(
      s.secenekler
    )
      .map(v =>
        String(v)
          .trim()
          .toLowerCase()
      );

  if (
    new Set(degerler).size !==
    degerler.length
  ) {
    return false;
  }

  return true;
}

/* ==========================================================================
   KONU BAZLI SORU ÜRETME
   ========================================================================== */

router.post(
  "/generate-questions",
  aiRateLimit,
  async (req, res) => {

    const {
      subject,
      topic,
      difficulty = "orta",
      count = 5
    } = req.body;

    const userId =
      req.header("X-User-Id");

    if (
      !subject ||
      !topic
    ) {

      return res.status(400).json({
        hata:
          "Ders ve konu zorunludur."
      });
    }

    const guvenliSayi =
      Math.max(
        1,
        Math.min(
          Number(count) || 5,
          20
        )
      );

    try {

      /*
       * AI ile soru üret.
       */

      let sorular =
        await soruUret({
          subject,
          topic,
          difficulty,
          count:
            guvenliSayi
        });

      /*
       * Kalite kontrolü.
       */

      let gecerliSorular =
        sorular.filter(
          soruGecerliMi
        );

      /*
       * Eksik varsa bir kez daha üret.
       */

      if (
        gecerliSorular.length <
        guvenliSayi
      ) {

        const eksik =
          guvenliSayi -
          gecerliSorular.length;

        const ekSorular =
          await soruUret({
            subject,
            topic,
            difficulty,
            count: eksik
          });

        gecerliSorular =
          gecerliSorular.concat(
            ekSorular.filter(
              soruGecerliMi
            )
          );
      }

      /*
       * Veritabanına kaydet.
       */

      const kaydedilenler =
        gecerliSorular
          .slice(
            0,
            guvenliSayi
          )
          .map(s => {

            const id =
              nanoid();

            db.prepare(`
              INSERT INTO questions
              (
                id,
                subject,
                topic,
                question,
                options,
                correct_answer,
                explanation,
                difficulty,
                source,
                created_by
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL)
            `).run(

              id,

              subject,

              topic,

              s.soru,

              JSON.stringify(
                s.secenekler
              ),

              s.dogruCevap,

              s.aciklama || "",

              difficulty
            );

            return {

              id,

              soru:
                s.soru,

              secenekler:
                s.secenekler,

              dogruCevap:
                s.dogruCevap,

              aciklama:
                s.aciklama || ""
            };
          });

      aiUsageKaydet(
        userId,
        "generate-questions"
      );

      res.json({
        sorular:
          kaydedilenler
      });

    } catch (err) {

      console.error(
        "[ai/generate-questions]",
        err.message
      );

      res.status(503).json({

        hata:
          "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen tekrar deneyin."

      });
    }
  }
);

/* ==========================================================================
   FOTOĞRAFTAN SORU ÇÖZ
   ========================================================================== */

router.post(
  "/solve-image",
  aiRateLimit,
  async (req, res) => {

    const {
      imageBase64,
      mimeType
    } = req.body;

    const userId =
      req.header("X-User-Id");

    if (!imageBase64) {

      return res.status(400).json({
        hata:
          "Görsel gönderilmedi."
      });
    }

    try {

      const metin =
        await aiProvider.generateWithImage({

          system:
            "Sen bir KPSS öğretmenisin. Sana bir soru fotoğrafı verilecek.",

          prompt: `
Bu görseldeki çoktan seçmeli soruyu ve şıklarını oku ve çöz.

Yalnızca şu JSON formatında cevap ver:

{
  "soru": "...",
  "secenekler": {
    "A": "...",
    "B": "...",
    "C": "...",
    "D": "...",
    "E": "..."
  },
  "dogruCevap": "A",
  "aciklama": "..."
}

Görsel okunamıyorsa veya soru net değilse:

{
  "hata": "Görseldeki soru okunamıyor."
}
`,

          imageBase64,

          mimeType:
            mimeType ||
            "image/jpeg"
        });

      const sonuc =
        guvenliJsonAyristir(
          metin
        );

      if (!sonuc) {

        return res.status(422).json({

          hata:
            "Görseldeki soru anlaşılamadı, lütfen daha net bir fotoğraf deneyin."

        });
      }

      if (sonuc.hata) {

        return res.status(422).json({
          hata:
            sonuc.hata
        });
      }

      aiUsageKaydet(
        userId,
        "solve-image"
      );

      res.json(sonuc);

    } catch (err) {

      console.error(
        "[ai/solve-image]",
        err.message
      );

      res.status(503).json({

        hata:
          "Yapay zekâ servisine şu anda ulaşılamıyor. Lütfen tekrar deneyin."

      });
    }
  }
);

/* ==========================================================================
   KARMA TEST
   ==========================================================================
   
   ÖNEMLİ:
   
   BU BÖLÜM ARTIK AI KULLANMIYOR.

   Kullanıcı 80 soruluk test istediğinde:

   Frontend
       ↓
   Railway Backend
       ↓
   SQLite questions tablosu
       ↓
   Rastgele sorular
       ↓
   Frontend

   OpenRouter'a istek gönderilmez.
   AI kotası kullanılmaz.
   Timeout riski çok büyük ölçüde azalır.
   ========================================================================== */

router.post(
  "/generate-mixed-test",
  aiRateLimit,
  async (req, res) => {

    const {
      istekler
    } = req.body;

    if (
      !Array.isArray(istekler) ||
      istekler.length === 0
    ) {

      return res.status(400).json({

        hata:
          "istekler dizisi zorunludur."

      });
    }

    try {

      const tumSorular = [];

      const kullanilanIdler =
        new Set();

      /*
       * İstenen ders/konu/soru sayılarını işle.
       */

      for (
        const istek of istekler
      ) {

        const {
          subject,
          topic,
          difficulty = "orta"
        } = istek;

        if (
          !subject ||
          !topic
        ) {
          continue;
        }

        const istenenSayi =
          Math.max(
            1,
            Math.min(
              Number(
                istek.count
              ) || 5,
              80
            )
          );

        let adaylar = [];

        /* ==========================================================
           1. AŞAMA
           Ders + Konu + Zorluk
           ========================================================== */

        try {

          adaylar =
            db.prepare(`
              SELECT
                id,
                subject,
                topic,
                question,
                options,
                correct_answer,
                explanation,
                difficulty
              FROM questions
              WHERE subject = ?
                AND topic = ?
                AND difficulty = ?
              ORDER BY RANDOM()
              LIMIT ?
            `).all(

              subject,
              topic,
              difficulty,
              istenenSayi
            );

        } catch (err) {

          console.error(
            "[mixed-test] DB ilk sorgu hatası:",
            err.message
          );
        }

        /* ==========================================================
           2. AŞAMA
           Aynı ders + aynı konu
           Zorluk fark etmez.
           ========================================================== */

        if (
          adaylar.length <
          istenenSayi
        ) {

          const eksik =
            istenenSayi -
            adaylar.length;

          const mevcutIdler =
            adaylar.map(
              s => s.id
            );

          let sorgu = `
            SELECT
              id,
              subject,
              topic,
              question,
              options,
              correct_answer,
              explanation,
              difficulty
            FROM questions
            WHERE subject = ?
              AND topic = ?
          `;

          const parametreler = [
            subject,
            topic
          ];

          if (
            mevcutIdler.length > 0
          ) {

            sorgu += `
              AND id NOT IN (
                ${mevcutIdler
                  .map(() => "?")
                  .join(",")}
              )
            `;

            parametreler.push(
              ...mevcutIdler
            );
          }

          sorgu += `
            ORDER BY RANDOM()
            LIMIT ?
          `;

          parametreler.push(
            eksik
          );

          try {

            const ekSorular =
              db.prepare(
                sorgu
              ).all(
                ...parametreler
              );

            adaylar =
              adaylar.concat(
                ekSorular
              );

          } catch (err) {

            console.error(
              "[mixed-test] DB ikinci sorgu hatası:",
              err.message
            );
          }
        }

        /* ==========================================================
           3. AŞAMA
           Aynı dersten farklı konulardan tamamla.
           ========================================================== */

        if (
          adaylar.length <
          istenenSayi
        ) {

          const eksik =
            istenenSayi -
            adaylar.length;

          const mevcutIdler =
            adaylar.map(
              s => s.id
            );

          let sorgu = `
            SELECT
              id,
              subject,
              topic,
              question,
              options,
              correct_answer,
              explanation,
              difficulty
            FROM questions
            WHERE subject = ?
          `;

          const parametreler = [
            subject
          ];

          if (
            mevcutIdler.length > 0
          ) {

            sorgu += `
              AND id NOT IN (
                ${mevcutIdler
                  .map(() => "?")
                  .join(",")}
              )
            `;

            parametreler.push(
              ...mevcutIdler
            );
          }

          sorgu += `
            ORDER BY RANDOM()
            LIMIT ?
          `;

          parametreler.push(
            eksik
          );

          try {

            const ekSorular =
              db.prepare(
                sorgu
              ).all(
                ...parametreler
              );

            adaylar =
              adaylar.concat(
                ekSorular
              );

          } catch (err) {

            console.error(
              "[mixed-test] DB üçüncü sorgu hatası:",
              err.message
            );
          }
        }

        /* ==========================================================
           SORULARI SONUCA EKLE
           ========================================================== */

        for (
          const soru of adaylar
        ) {

          /*
           * Aynı soru başka bir dersten/konudan
           * gelmişse tekrar ekleme.
           */

          const soruId =
            String(
              soru.id
            );

          if (
            kullanilanIdler.has(
              soruId
            )
          ) {
            continue;
          }

          kullanilanIdler.add(
            soruId
          );

          /* ========================================================
             OPTIONS JSON
             ======================================================== */

          let secenekler =
            soru.options;

          try {

            if (
              typeof secenekler ===
              "string"
            ) {

              secenekler =
                JSON.parse(
                  secenekler
                );
            }

          } catch (err) {

            console.error(
              "[mixed-test] Options JSON hatası:",
              soru.id
            );

            continue;
          }

          /*
           * Şıklar obje değilse soruyu atla.
           */

          if (
            !secenekler ||
            typeof secenekler !==
              "object"
          ) {

            continue;
          }

          /* ========================================================
             FRONTEND FORMATINA ÇEVİR
             ======================================================== */

          tumSorular.push({

            id:
              soru.id,

            subject:
              soru.subject,

            topic:
              soru.topic,

            soru:
              soru.question,

            secenekler:
              secenekler,

            dogruCevap:
              soru.correct_answer,

            aciklama:
              soru.explanation ||
              "",

            difficulty:
              soru.difficulty
          });
        }
      }

      /* ============================================================
         HİÇ SORU YOKSA
         ============================================================ */

      if (
        tumSorular.length === 0
      ) {

        return res.status(404).json({

          hata:
            "Veritabanında henüz soru bulunamadı. Önce soru havuzunu oluşturmalısın."

        });
      }

      /* ============================================================
         TOPLAM İSTENEN SORU SAYISI
         ============================================================ */

      const toplamIstenen =
        istekler.reduce(
          (
            toplam,
            istek
          ) => {

            return (
              toplam +
              Math.max(
                1,
                Math.min(
                  Number(
                    istek.count
                  ) || 5,
                  80
                )
              )
            );

          },
          0
        );

      /* ============================================================
         SORULARI KARIŞTIR
         ============================================================ */

      for (
        let i =
          tumSorular.length - 1;
        i > 0;
        i--
      ) {

        const j =
          Math.floor(
            Math.random() *
            (i + 1)
          );

        [
          tumSorular[i],
          tumSorular[j]
        ] = [
          tumSorular[j],
          tumSorular[i]
        ];
      }

      /* ============================================================
         İSTENEN SAYI KADAR SORU GÖNDER
         ============================================================ */

      const sonuc =
        tumSorular.slice(
          0,
          Math.min(
            toplamIstenen,
            tumSorular.length
          )
        );

      console.log(
        `[generate-mixed-test] DB'den ${sonuc.length} soru getirildi. AI kullanılmadı.`
      );

      /*
       * DİKKAT:
       *
       * Burada aiUsageKaydet() YOK.
       *
       * Çünkü bu işlem OpenRouter kullanmıyor.
       */

      res.json({

        sorular:
          sonuc,

        toplam:
          sonuc.length,

        aiKullanildi:
          false

      });

    } catch (err) {

      console.error(
        "[ai/generate-mixed-test]",
        err.message
      );

      res.status(500).json({

        hata:
          "Sorular veritabanından alınırken bir hata oluştu."

      });
    }
  }
);

/* ==========================================================================
   ROUTER
   ========================================================================== */

module.exports = router;
