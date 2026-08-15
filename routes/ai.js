const express = require("express");

const router = express.Router();

const MAX_SORU = 5;
const MOCK_EXAM_SORU = 20;
const TIMEOUT_MS = 110000;
const MAX_JSON_DENEME = 2;

function temizJson(metin) {
  if (!metin || typeof metin !== "string") return null;
  let temiz = metin.trim();
  temiz = temiz.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(temiz); } catch (_) {}
  const baslangic = temiz.indexOf("{");
  if (baslangic === -1) return null;
  let derinlik = 0, stringIcinde = false, escape = false;
  for (let i = baslangic; i < temiz.length; i++) {
    const karakter = temiz[i];
    if (escape) { escape = false; continue; }
    if (karakter === "\\" && stringIcinde) { escape = true; continue; }
    if (karakter === '"') { stringIcinde = !stringIcinde; continue; }
    if (stringIcinde) continue;
    if (karakter === "{") derinlik++;
    else if (karakter === "}") {
      derinlik--;
      if (derinlik === 0) {
        try { return JSON.parse(temiz.substring(baslangic, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function soruGecerliMi(soru) {
  if (!soru || typeof soru !== "object" || !soru.soru || typeof soru.soru !== "string") return false;
  if (!soru.secenekler || typeof soru.secenekler !== "object") return false;
  const harfler = ["A", "B", "C", "D", "E"];
  if (!harfler.every(h => typeof soru.secenekler[h] === "string" && soru.secenekler[h].trim())) return false;
  return harfler.includes(String(soru.dogruCevap || "").toUpperCase());
}

async function openRouterSoruIste({ apiKey, model, prompt, signal }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://kpss-backend-production.up.railway.app",
      "X-Title": "KPSS-2026"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Sen KPSS Ortaogretim icin kaliteli, ozgun ve dogru test sorulari hazirlayan uzman bir ogretmensin. Cevabin yalnizca gecerli JSON nesnesi olmalidir. JSON disinda tek bir karakter bile yazma." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 6000,
      response_format: { type: "json_object" }
    }),
    signal
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`OpenRouter API ${response.status}`);
  let data;
  try { data = JSON.parse(responseText); } catch (_) { throw new Error("OpenRouter cevabi JSON olarak okunamadi."); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter bos cevap dondurdu.");
  return content;
}

async function sorulariUret(istekler) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY Railway Variables bölümünde bulunamadı.");

  const konular = [];
  let kalan = MAX_SORU;
  for (const istek of istekler || []) {
    if (!istek || !istek.subject || kalan <= 0) continue;
    let sayi = Number(istek.count);
    if (!Number.isFinite(sayi) || sayi <= 0) sayi = 1;
    sayi = Math.min(Math.floor(sayi), kalan);
    konular.push({ subject: String(istek.subject), topic: String(istek.topic || "Genel"), difficulty: String(istek.difficulty || "orta"), count: sayi });
    kalan -= sayi;
  }
  if (!konular.length) konular.push({ subject: "Türkçe", topic: "Genel", difficulty: "orta", count: MAX_SORU });

  const toplamIstenen = Math.min(MAX_SORU, konular.reduce((t, k) => t + k.count, 0));
  const konuMetni = konular.map((k, i) => `${i + 1}. Ders: ${k.subject}\nKonu: ${k.topic}\nZorluk: ${k.difficulty}\nSoru sayısı: ${k.count}`).join("\n\n");
  const prompt = `
Sen Türkiye'deki 2026 KPSS Ortaöğretim sınavına hazırlanan öğrenciler için soru hazırlayan uzman bir KPSS öğretmenisin.

Aşağıdaki ders ve konulara göre TAM OLARAK ${toplamIstenen} adet soru üret.

DERSLER:
${konuMetni}

KURALLAR:
1. Sorular KPSS Ortaöğretim seviyesinde olsun.
2. Her soru 5 seçenekli olsun: A, B, C, D, E.
3. Her soruda yalnızca BİR doğru cevap olsun.
4. dogruCevap yalnızca A, B, C, D veya E olsun.
5. Sorular özgün ve açık Türkçe ile yazılsın.
6. Şıklar mantıklı çeldiriciler içersin.
7. Aynı soruyu tekrar etme.
8. Her sorunun kısa açıklaması olsun.
9. JSON içindeki metinler geçerli JSON stringleri olmalıdır.
10. JSON dışında hiçbir açıklama, markdown veya kod bloğu yazma.

SADECE şu yapıda geçerli JSON döndür:
{"sorular":[{"subject":"Türkçe","topic":"Sözcükte Anlam","soru":"Soru metni","secenekler":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"dogruCevap":"A","aciklama":"Kısa açıklama"}]}`;

  const model = process.env.OPENROUTER_MODEL || "openrouter/free";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let sonHata = null;
    for (let deneme = 1; deneme <= MAX_JSON_DENEME; deneme++) {
      try {
        console.log(`[OpenRouter] ${toplamIstenen} soru isteniyor. Model: ${model}. Deneme: ${deneme}/${MAX_JSON_DENEME}`);
        const content = await openRouterSoruIste({ apiKey, model, prompt, signal: controller.signal });
        console.log(`[OpenRouter] Cevap alindi. Uzunluk: ${content.length}`);
        const sonuc = temizJson(content);
        if (!sonuc) { sonHata = new Error("Yapay zeka gecerli JSON uretmedi."); continue; }
        const sorular = Array.isArray(sonuc) ? sonuc : (Array.isArray(sonuc.sorular) ? sonuc.sorular : []);
        const gecerliSorular = sorular.filter(soruGecerliMi).slice(0, MAX_SORU).map((soru, index) => ({
          id: `ai-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
          subject: soru.subject || "KPSS",
          topic: soru.topic || "Genel",
          soru: soru.soru.trim(),
          secenekler: { A: String(soru.secenekler.A), B: String(soru.secenekler.B), C: String(soru.secenekler.C), D: String(soru.secenekler.D), E: String(soru.secenekler.E) },
          dogruCevap: String(soru.dogruCevap).toUpperCase(),
          aciklama: String(soru.aciklama || "")
        }));
        if (gecerliSorular.length === 0) { sonHata = new Error("Yapay zekadan gecerli soru alinamadi."); continue; }
        return gecerliSorular;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        sonHata = err;
        console.error(`[OpenRouter] Deneme ${deneme} basarisiz:`, err.message);
      }
    }
    throw sonHata || new Error("Yapay zeka gecerli JSON uretmedi.");
  } finally { clearTimeout(timeout); }
}

function mockExamBatchleriOlustur(istekler) {
  const kalanlar = (istekler || []).map(x => ({ ...x, count: Math.max(0, Number(x.count) || 0) }));
  const batchler = [];
  while (kalanlar.some(x => x.count > 0) && batchler.length < 4) {
    let kapasite = MAX_SORU;
    const batch = [];
    for (const item of kalanlar) {
      if (kapasite <= 0) break;
      if (item.count <= 0) continue;
      const sayi = Math.min(item.count, kapasite);
      batch.push({ ...item, count: sayi });
      item.count -= sayi;
      kapasite -= sayi;
    }
    if (batch.length) batchler.push(batch);
  }
  return batchler;
}

router.post("/generate-mixed-test", async (req, res) => {
  try {
    const { istekler } = req.body || {};
    if (!Array.isArray(istekler) || !istekler.length) return res.status(400).json({ hata: "Ders ve konu bilgisi gonderilmedi." });
    console.log("[ai/generate-mixed-test] Test hazirlaniyor...");
    const sorular = await sorulariUret(istekler);
    if (!sorular?.length) return res.status(503).json({ hata: "Yapay zeka soru olusturamadi. Lutfen tekrar deneyin." });
    console.log(`[ai/generate-mixed-test] ${sorular.length} soru basariyla hazirlandi.`);
    return res.json({ ok: true, sorular });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ hata: "Soru olusturma islemi zaman asimina ugradi. Lutfen tekrar deneyin." });
    console.error("[ai/generate-mixed-test]", err.message);
    return res.status(503).json({ hata: "Yapay zeka servisine ulasilamadi. Lutfen tekrar deneyin." });
  }
});

router.post("/generate-mock-exam", async (req, res) => {
  try {
    const { istekler } = req.body || {};
    if (!Array.isArray(istekler) || !istekler.length) return res.status(400).json({ hata: "Deneme için ders ve konu bilgisi gönderilmedi." });
    const batchler = mockExamBatchleriOlustur(istekler);
    if (batchler.length !== 4) return res.status(400).json({ hata: "Deneme 20 soru için yeterli soru dağılımı oluşturulamadı." });

    console.log("[ai/generate-mock-exam] 20 soruluk deneme hazırlanıyor; 4 x 5 soru.");
    const tumSorular = [];
    for (let i = 0; i < batchler.length; i++) {
      const batchSorular = await sorulariUret(batchler[i]);
      if (!batchSorular || batchSorular.length < 5) throw new Error(`Deneme ${i + 1}. soru paketi tamamlanamadı.`);
      tumSorular.push(...batchSorular.slice(0, 5));
    }

    return res.json({ ok: true, sorular: tumSorular.slice(0, MOCK_EXAM_SORU), soruSayisi: tumSorular.length });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ hata: "Deneme hazırlanırken zaman aşımı oluştu. Lütfen tekrar deneyin." });
    console.error("[ai/generate-mock-exam]", err.message);
    return res.status(503).json({ hata: "20 soruluk deneme şu anda hazırlanamadı. Lütfen tekrar deneyin." });
  }
});

router.get("/health", (req, res) => res.json({ ok: true, servis: "KPSS AI", sistem: "OpenRouter", maksimumSoru: MAX_SORU, denemeSoru: MOCK_EXAM_SORU }));

module.exports = router;
