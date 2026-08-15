/* ==========================================================================
   routes/ai.js
   KPSS 2026 Ortaogretim - AI islemleri
   ========================================================================== */

const express = require("express");
const { nanoid } = require("nanoid");
const aiProvider = require("../services/aiProvider");
const { searchWeb } = require("../services/webSearch");
const { aiRateLimit } = require("../middleware/rateLimit");
const db = require("../db/db");

const router = express.Router();

/* ==========================================================================
   KPSS SISTEM TALIMATI
   ========================================================================== */

const SINAV_SISTEM_TALIMATI = `
Sen 2026 KPSS Ortaogretim sinavina hazirlanan bir ogrenciye yardimci olan,
uzman bir KPSS ogretmenisin.

- Her zaman KPSS sinavi baglaminda cevap ver.
- Cevaplarini Turkce ver.
- Emin olmadigin guncel bilgileri uydurma.
- Sana kaynak metinleri verilirse oncelikle bu kaynaklara dayan.
`;

/* ==========================================================================
   GUNCEL BILGI KONTROLU
   ========================================================================== */

function guncelBilgiGerekiyorMu(soru) {
  const anahtarKelimeler = [
    "guncel",
    "su an",
    "su anda",
    "kim",
    "2026",
    "2025",
    "bu yil",
    "son",
    "yeni",
    "degisti",
    "degisiklik",
    "atandi",
    "secildi",
    "kazandi"
  ];

  const kucuk = soru.toLocaleLowerCase("tr");

  return anahtarKelimeler.some(k =>
    kucuk.includes(k)
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
    process.env.AI_PROVIDER || "openrouter"
  );
}

/* ==========================================================================
   GUVENLI JSON AYRISTIRICI
   ========================================================================== */

function guvenliJsonAyristir(metin) {
  try {
    if (!metin || typeof metin !== "string") {
      return null;
    }

    const temiz = metin
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(temiz);

  } catch (err) {
    console.error(
      "[JSON AYRISTIRMA HATASI]",
      err.message
    );

    return null;
  }
}

/* ==========================================================================
   AI OGRETMEN
   ========================================================================== */

router.post("/teacher", aiRateLimit, async (req, res) => {

  const { soru } = req.body;
  const userId = req.header("X-User-Id");

  if (!soru || !soru.trim()) {
    return res.status(400).json({
      hata: "Soru bos olamaz."
    });
  }

  try {

    let kaynaklar = [];
    let kaynakMetni = "";

    if (guncelBilgiGerekiyorMu(soru)) {

      kaynaklar = await searchWeb(
        soru,
        {
          onlyTrusted: true,
          limit: 5
        }
      );

      if (kaynaklar.length > 0) {

        kaynakMetni =
          "\n\nAsagidaki guncel kaynaklari dikkate alarak cevap ver:\n" +
          kaynaklar
            .map(
              (k, i) =>
                `[${i + 1}] ${k.baslik} (${k.kaynak}) - ${k.icerikOzeti}`
            )
            .join("\n");
      }
    }

    const cevapMetni =
      await aiProvider.generate({

        system: SINAV_SISTEM_TALIMATI,

        prompt:
          `Ogrenci sorusu: "${soru}"` +
          kaynakMetni +
          `

Kisa, anlasilir ve KPSS odakli cevap ver.

Uygunsa su basliklari kullan:
- KPSS'de onemli
- Karistirma
- Ezberle
`
      });

    aiUsageKaydet(
      userId,
      "teacher"
    );

    res.json({
      cevap: cevapMetni,

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
        "Yapay zeka servisine su anda ulasilamiyor. Lutfen tekrar deneyin."
    });
  }
});

/* ==========================================================================
   SORU URETME
   ========================================================================== */

async function soruUret({
  subject,
  topic,
  difficulty,
  count
}) {

  const prompt = `
KPSS Ortaogretim seviyesinde,
"${subject}" dersinin "${topic}" konusunda,
"${difficulty}" zorlukta,
TAMAMEN OZGÜN ${count} adet coktan secmeli soru uret.

Kurallar:

- Her sorunun tek bir dogru cevabi olmali.
- 5 secenek olmali: A, B, C, D, E.
- Celdiriciler mantikli ve konuyla ilgili olmali.
- Telif hakki olan yayinlardan dogrudan kopya yapma.
- Sorulari kendi cumlelerinle ozgun olarak yaz.
- Bilgi hatasi yapma.
- KPSS Ortaogretim seviyesine uygun ol.
- Sorular birbirinin aynisi olmamali.

SADECE ASAGIDAKI JSON FORMATINDA CEVAP VER:

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
        "Sen ozgun KPSS sorulari hazirlayan uzman bir soru yazarisisin. Yalnizca istenen JSON formatinda cevap ver.",

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
   SORU KALITE KONTROLU
   ========================================================================== */

function soruGecerliMi(s) {

  if (!s || typeof s !== "object") {
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
    Object.keys(s.secenekler);

  if (
    !["A", "B", "C", "D", "E"]
      .every(h => anahtarlar.includes(h))
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
    Object.values(s.secenekler)
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
   KONU BAZLI SORU URET
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

    if (!subject || !topic) {
      return res.status(400).json({
        hata: "Ders ve konu zorunludur."
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

      let sorular =
        await soruUret({
          subject,
          topic,
          difficulty,
          count: guvenliSayi
        });

      let gecerliSorular =
        sorular.filter(soruGecerliMi);

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

      const kaydedilenler =
        gecerliSorular
          .slice(0, guvenliSayi)
          .map(s => {

            const id = nanoid();

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
              soru: s.soru,
              secenekler: s.secenekler,
              dogruCevap: s.dogruCevap,
              aciklama:
                s.aciklama || ""
            };
          });

      aiUsageKaydet(
        userId,
        "generate-questions"
      );

      res.json({
        sorular: kaydedilenler
      });

    } catch (err) {

      console.error(
        "[ai/generate-questions]",
        err.message
      );

      res.status(503).json({
        hata:
          "Yapay zeka servisine su anda ulasilamiyor. Lutfen tekrar deneyin."
      });
    }
  }
);

/* ==========================================================================
   FOTOĞRAFTAN SORU COZ
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
        hata: "Gorsel gonderilmedi."
      });
    }

    try {

      const metin =
        await aiProvider.generateWithImage({

          system:
            "Sen bir KPSS ogretmenisin. Sana bir soru fotografi verilecek.",

          prompt: `
Bu gorseldeki coktan secmeli soruyu ve siklarini oku ve coz.

Yalnizca su JSON formatinda cevap ver:

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

Gorsel okunamiyorsa:

{
  "hata": "Gorseldeki soru okunamiyor."
}
`,

          imageBase64,

          mimeType:
            mimeType || "image/jpeg"
        });

      const sonuc =
        guvenliJsonAyristir(metin);

      if (!sonuc) {

        return res.status(422).json({
          hata:
            "Gorseldeki soru anlasilamadi. Lutfen daha net bir fotograf deneyin."
        });
      }

      if (sonuc.hata) {

        return res.status(422).json({
          hata: sonuc.hata
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
          "Yapay zeka servisine su anda ulasilamiyor. Lutfen tekrar deneyin."
      });
    }
  }
);

/* ==========================================================================
   KARMA TEST
   ==========================================================================

   ESKI SISTEM:
   80 soru -> uzun istekler -> timeout riski

   YENI SISTEM:
   80 soru
   -> 10
   -> 10
   -> 10
   -> 10
   -> 10
   -> 10
   -> 10
   -> 10

   Ayni anda maksimum 4 AI istegi calisir.
   ========================================================================== */

router.post(
  "/generate-mixed-test",
  aiRateLimit,
  async (req, res) => {

    const { istekler } = req.body;

    const userId =
      req.header("X-User-Id");

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

      /* ----------------------------------------------------------
         GOREVLERI 10'AR SORULUK PARCALARA BOL
         ---------------------------------------------------------- */

      const gorevler = [];

      for (const istek of istekler) {

        const {
          subject,
          topic,
          difficulty = "orta"
        } = istek;

        if (!subject || !topic) {
          continue;
        }

        const toplamSayi =
          Math.max(
            1,
            Math.min(
              Number(istek.count) || 5,
              20
            )
          );

        for (
          let kalan = toplamSayi;
          kalan > 0;
          kalan -= 10
        ) {

          gorevler.push({
            subject,
            topic,
            difficulty,
            count:
              Math.min(
                kalan,
                10
              )
          });
        }
      }

      console.log(
        `[generate-mixed-test] ${gorevler.length} AI gorevi olusturuldu.`
      );

      /* ----------------------------------------------------------
         AYNI ANDA MAKSIMUM 4 GOREV
         ---------------------------------------------------------- */

      const MAX_PARALLEL = 4;

      for (
        let baslangic = 0;
        baslangic < gorevler.length;
        baslangic += MAX_PARALLEL
      ) {

        const grup =
          gorevler.slice(
            baslangic,
            baslangic +
              MAX_PARALLEL
          );

        console.log(
          `[generate-mixed-test] ${baslangic + 1}-${baslangic + grup.length} gorev calisiyor...`
        );

        const sonuclar =
          await Promise.all(

            grup.map(
              async gorev => {

                try {

                  /* ----------------------------------------------
                     ILK AI ISTEGI
                     ---------------------------------------------- */

                  let sorular =
                    await soruUret({
                      subject:
                        gorev.subject,

                      topic:
                        gorev.topic,

                      difficulty:
                        gorev.difficulty,

                      count:
                        gorev.count
                    });

                  let gecerliSorular =
                    sorular.filter(
                      soruGecerliMi
                    );

                  /* ----------------------------------------------
                     EKSIK SORULARI TAMAMLA
                     ---------------------------------------------- */

                  if (
                    gecerliSorular.length <
                    gorev.count
                  ) {

                    const eksik =
                      gorev.count -
                      gecerliSorular.length;

                    console.log(
                      `[generate-mixed-test] ${gorev.subject}/${gorev.topic}: ${eksik} eksik soru tekrar isteniyor.`
                    );

                    const ekSorular =
                      await soruUret({
                        subject:
                          gorev.subject,

                        topic:
                          gorev.topic,

                        difficulty:
                          gorev.difficulty,

                        count:
                          eksik
                      });

                    gecerliSorular =
                      gecerliSorular.concat(
                        ekSorular.filter(
                          soruGecerliMi
                        )
                      );
                  }

                  return {
                    gorev,

                    sorular:
                      gecerliSorular.slice(
                        0,
                        gorev.count
                      )
                  };

                } catch (err) {

                  console.error(
                    `[generate-mixed-test] ${gorev.subject}/${gorev.topic} hatasi:`,
                    err.message
                  );

                  return {
                    gorev,
                    sorular: []
                  };
                }
              }
            )
          );

        /* ----------------------------------------------------------
           SONUCLARI VERITABANINA KAYDET
           ---------------------------------------------------------- */

        for (
          const sonuc of sonuclar
        ) {

          for (
            const s of sonuc.sorular
          ) {

            try {

              const id = nanoid();

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

                sonuc.gorev.subject,

                sonuc.gorev.topic,

                s.soru,

                JSON.stringify(
                  s.secenekler
                ),

                s.dogruCevap,

                s.aciklama || "",

                sonuc.gorev.difficulty
              );

              tumSorular.push({

                id,

                subject:
                  sonuc.gorev.subject,

                topic:
                  sonuc.gorev.topic,

                soru:
                  s.soru,

                secenekler:
                  s.secenekler,

                dogruCevap:
                  s.dogruCevap,

                aciklama:
                  s.aciklama || ""
              });

            } catch (dbErr) {

              console.error(
                "[generate-mixed-test] DB kayit hatasi:",
                dbErr.message
              );
            }
          }
        }

        console.log(
          `[generate-mixed-test] Su ana kadar ${tumSorular.length} soru hazir.`
        );
      }

      /* ----------------------------------------------------------
         HIC SORU GELMEDIYSE
         ---------------------------------------------------------- */

      if (
        tumSorular.length === 0
      ) {

        return res.status(503).json({
          hata:
            "Sorular uretilemedi. Lutfen tekrar deneyin."
        });
      }

      /* ----------------------------------------------------------
         KULLANIM KAYDI
         ---------------------------------------------------------- */

      aiUsageKaydet(
        userId,
        "generate-mixed-test"
      );

      console.log(
        `[generate-mixed-test] TAMAMLANDI: ${tumSorular.length} soru`
      );

      /* ----------------------------------------------------------
         FRONTEND'E GONDER
         ---------------------------------------------------------- */

      res.json({
        sorular: tumSorular
      });

    } catch (err) {

      console.error(
        "[ai/generate-mixed-test]",
        err.message
      );

      res.status(503).json({
        hata:
          "Yapay zeka servisine su anda ulasilamiyor. Lutfen tekrar deneyin."
      });
    }
  }
);

/* ==========================================================================
   ROUTER
   ========================================================================== */

module.exports = router;
