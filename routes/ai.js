const express = require("express");
const router = express.Router();

const MAX_SORU = 5;
const MOCK_EXAM_SORU = 20;
const TIMEOUT_MS = 110000;
const MAX_JSON_DENEME = 4;

// 2026-08 itibarıyla OpenRouter'da gerçekten ücretsiz olan ve soru üretiminde
// kullanılabilecek sabit modeller. Qwen3 Next :free varyantı artık ücretsiz değil;
// bu yüzden kesinlikle listeye alınmıyor. openrouter/free de kullanılmıyor çünkü
// rastgele model seçimi üretim kararlılığını bozabiliyor.
const VARSAYILAN_SORU_MODELLERI = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "meta-llama/llama-3.3-70b-instruct:free"
];

function modelListesi() {
  const envModel = String(process.env.OPENROUTER_MODEL || "").trim();
  const izinli = new Set(VARSAYILAN_SORU_MODELLERI);
  const adaylar = [envModel, ...VARSAYILAN_SORU_MODELLERI].filter(model => izinli.has(model));
  return [...new Set(adaylar)];
}

function temizJson(metin) {
  if (!metin || typeof metin !== "string") return null;
  let temiz = metin.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(temiz); } catch (_) {}
  const baslangicNesne = temiz.indexOf("{");
  const baslangicDizi = temiz.indexOf("[");
  let baslangic = -1;
  if (baslangicNesne === -1) baslangic = baslangicDizi;
  else if (baslangicDizi === -1) baslangic = baslangicNesne;
  else baslangic = Math.min(baslangicNesne, baslangicDizi);
  if (baslangic === -1) return null;
  const acilis = temiz[baslangic];
  const kapanis = acilis === "{" ? "}" : "]";
  let derinlik = 0, stringIcinde = false, escape = false;
  for (let i = baslangic; i < temiz.length; i++) {
    const karakter = temiz[i];
    if (escape) { escape = false; continue; }
    if (karakter === "\\" && stringIcinde) { escape = true; continue; }
    if (karakter === '"') { stringIcinde = !stringIcinde; continue; }
    if (stringIcinde) continue;
    if (karakter === acilis) derinlik++;
    else if (karakter === kapanis) {
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
        { role: "system", content: "Sen KPSS Ortaöğretim için kaliteli ve özgün test soruları hazırlayan uzman bir öğretmensin. ÇIKTIYI SADECE GEÇERLİ JSON OLARAK VER. JSON dışında tek karakter açıklama yazma." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 6000,
      response_format: { type: "json_object" }
    }),
    signal
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`OpenRouter API ${response.status}: ${responseText.substring(0, 500)}`);
  let data;
  try { data = JSON.parse(responseText); } catch (_) { throw new Error("OpenRouter cevabi JSON olarak okunamadi."); }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter bos cevap dondurdu.");
  return content;
}

function promptOlustur(konular, toplamIstenen, tekrarNo = 0) {
  const konuMetni = konular.map((k, i) => `${i + 1}. Ders: ${k.subject}\nKonu: ${k.topic}\nZorluk: ${k.difficulty}\nSoru sayısı: ${k.count}`).join("\n\n");
  const tekrarUyari = tekrarNo > 0 ? `\nÖNEMLİ: Önceki üretim geçerli JSON olarak doğrulanamadı. Bu kez JSON sözdizimini özellikle kontrol et. JSON dışında hiçbir şey yazma.\n` : "";
  return `Sen Türkiye'deki KPSS Ortaöğretim sınavına hazırlanan öğrenciler için soru hazırlayan uzman bir KPSS öğretmenisin.

Aşağıdaki ders ve konulara göre TAM OLARAK ${toplamIstenen} adet soru üret.
${tekrarUyari}
DERSLER:
${konuMetni}

KURALLAR:
1. KPSS Ortaöğretim seviyesinde, özgün ve açık Türkçe kullan.
2. Her soru 5 seçenekli olsun: A, B, C, D, E.
3. Yalnızca bir doğru cevap olsun.
4. dogruCevap yalnızca A, B, C, D veya E olsun.
5. Mantıklı çeldiriciler kullan.
6. Bilgi ve hesaplamaları kontrol et.
7. Her soruya kısa ve öğretici açıklama ekle.
8. Aynı soruyu veya seçenekleri tekrar etme.
9. JSON dışında hiçbir açıklama, markdown, kod bloğu veya selamlama yazma.
10. Tüm metinler geçerli JSON stringleri olmalı; çift tırnakları gerektiğinde escape et.

SADECE şu yapıda geçerli JSON döndür:
{"sorular":[{"subject":"Türkçe","topic":"Sözcükte Anlam","soru":"Soru metni","secenekler":{"A":"A seçeneği","B":"B seçeneği","C":"C seçeneği","D":"D seçeneği","E":"E seçeneği"},"dogruCevap":"A","aciklama":"Kısa açıklama"}]}`;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const modeller = modelListesi();
  try {
    let sonHata = null;
    for (let deneme = 1; deneme <= MAX_JSON_DENEME; deneme++) {
      const model = modeller[(deneme - 1) % modeller.length];
      try {
        console.log(`[OpenRouter] ${toplamIstenen} soru isteniyor. Model: ${model}`);
        console.log(`[OpenRouter] JSON üretim denemesi: ${deneme}/${MAX_JSON_DENEME}`);
        const content = await openRouterSoruIste({ apiKey, model, prompt: promptOlustur(konular, toplamIstenen, deneme - 1), signal: controller.signal });
        console.log(`[OpenRouter] Cevap alindi. Uzunluk: ${content.length}`);
        if (/^(User Safety|Safety)\s*:/i.test(content.trim())) throw new Error(`Model moderasyon çıktısı döndürdü: ${content.trim().substring(0, 200)}`);
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
        if (gecerliSorular.length < toplamIstenen) { sonHata = new Error(`Model ${toplamIstenen} soru yerine ${gecerliSorular.length} geçerli soru üretti.`); continue; }
        console.log(`[OpenRouter] ${gecerliSorular.length} soru hazir.`);
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
      console.log(`[ai/generate-mock-exam] Paket ${i + 1}/4 hazırlanıyor.`);
      const batchSorular = await sorulariUret(batchler[i]);
      if (!batchSorular || batchSorular.length < 5) throw new Error(`Deneme ${i + 1}. soru paketi tamamlanamadı.`);
      tumSorular.push(...batchSorular.slice(0, 5));
    }
    console.log(`[ai/generate-mock-exam] Deneme hazır: ${tumSorular.length}/20 soru.`);
    return res.json({ ok: true, sorular: tumSorular.slice(0, MOCK_EXAM_SORU), soruSayisi: tumSorular.length });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ hata: "Deneme hazırlanırken zaman aşımı oluştu. Lütfen tekrar deneyin." });
    console.error("[ai/generate-mock-exam]", err.message);
    return res.status(503).json({ hata: "20 soruluk deneme şu anda hazırlanamadı. Lütfen tekrar deneyin.", ayrinti: err.message });
  }
});

router.get("/health", (req, res) => res.json({ ok: true, servis: "KPSS AI", sistem: "OpenRouter", modeller: modelListesi(), maksimumSoru: MAX_SORU, denemeSoru: MOCK_EXAM_SORU }));

module.exports = router;
