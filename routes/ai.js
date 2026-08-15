const express = require("express");
const aiProvider = require("../services/aiProvider");
const router = express.Router();

const MAX_SORU_PAKET = 5;
const MAX_TEST = 40;
const MOCK_EXAM_SORU = 20;
const TIMEOUT_MS = 110000;
const MAX_JSON_DENEME = 3;

function modelListesi() { return aiProvider.getModels(); }

function temizJson(metin) {
  if (!metin || typeof metin !== "string") return null;
  let temiz = metin.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(temiz); } catch (_) {}
  const bas = Math.min(...[temiz.indexOf("{"), temiz.indexOf("[")].filter(x => x >= 0));
  if (!Number.isFinite(bas)) return null;
  const ac = temiz[bas], kap = ac === "{" ? "}" : "]";
  let depth = 0, str = false, esc = false;
  for (let i = bas; i < temiz.length; i++) {
    const c = temiz[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && str) { esc = true; continue; }
    if (c === '"') { str = !str; continue; }
    if (str) continue;
    if (c === ac) depth++;
    if (c === kap && --depth === 0) { try { return JSON.parse(temiz.slice(bas, i + 1)); } catch (_) { return null; } }
  }
  return null;
}

function soruGecerliMi(s) {
  if (!s || typeof s !== "object" || typeof s.soru !== "string" || !s.soru.trim()) return false;
  const sec = s.secenekler;
  if (!sec || typeof sec !== "object") return false;
  if (!["A","B","C","D","E"].every(h => typeof sec[h] === "string" && sec[h].trim())) return false;
  return ["A","B","C","D","E"].includes(String(s.dogruCevap || "").toUpperCase());
}

function promptOlustur(konular, toplam, tur = 0, oncekiler = []) {
  const konuMetni = konular.map((k,i) => `${i+1}. Ders: ${k.subject}\nKonu: ${k.topic}\nZorluk: ${k.difficulty}\nSoru: ${k.count}`).join("\n\n");
  const onceki = oncekiler.length ? `\nÖNCEKİ SORULARIN İLK CÜMLELERİ; BUNLARA BENZER SORU ÜRETME:\n${oncekiler.slice(-12).map(x=>`- ${x}`).join("\n")}` : "";
  return `Türkiye KPSS Ortaöğretim için uzman öğretmen olarak TAM OLARAK ${toplam} özgün çoktan seçmeli soru üret.
${tur ? "Önceki üretim başarısız oldu; JSON sözdizimini özellikle kontrol et." : ""}
${konuMetni}${onceki}

Kurallar:
- Her soru A,B,C,D,E olmak üzere 5 seçenekli ve tek doğru cevaplıdır.
- KPSS seviyesinde, açık Türkçe, gerçekçi çeldiriciler kullan.
- Hesaplamaları ve tarihsel bilgileri kontrol et.
- Her soruda kısa öğretici açıklama bulunur.
- Aynı soru, aynı seçenek dizilimi veya bariz varyasyonları tekrar etme.
- JSON dışında hiçbir şey yazma.
- Türkçe karakterler geçerli JSON stringi olarak yazılmalı.

SADECE şu JSON yapısını döndür:
{"sorular":[{"subject":"Türkçe","topic":"...","soru":"...","secenekler":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"dogruCevap":"A","aciklama":"..."}]}`;
}

async function paketUret(istekler, toplam, oncekiler = []) {
  let lastError = null;
  for (let deneme = 1; deneme <= MAX_JSON_DENEME; deneme++) {
    try {
      console.log(`[OpenRouter] ${toplam} soru isteniyor. JSON denemesi ${deneme}/${MAX_JSON_DENEME}`);
      const content = await aiProvider.generate({
        system: "Sen yalnızca geçerli JSON üreten KPSS soru yazarı ve öğretmensin. JSON dışında hiçbir şey yazma.",
        prompt: promptOlustur(istekler, toplam, deneme - 1, oncekiler),
        jsonMode: true
      });
      const parsed = temizJson(content);
      const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.sorular) ? parsed.sorular : []);
      const valid = raw.filter(soruGecerliMi).slice(0, toplam).map((s,i) => ({
        id:`ai-${Date.now()}-${i}-${Math.random().toString(36).slice(2,7)}`,
        subject:s.subject || istekler[0]?.subject || "KPSS",
        topic:s.topic || istekler[0]?.topic || "Genel",
        soru:s.soru.trim(),
        secenekler:{A:String(s.secenekler.A),B:String(s.secenekler.B),C:String(s.secenekler.C),D:String(s.secenekler.D),E:String(s.secenekler.E)},
        dogruCevap:String(s.dogruCevap).toUpperCase(),
        aciklama:String(s.aciklama || "")
      }));
      if (valid.length < toplam) throw new Error(`Model ${toplam} yerine ${valid.length} geçerli soru döndürdü.`);
      return valid;
    } catch (err) { lastError = err; console.error(`[OpenRouter] Paket denemesi ${deneme} başarısız: ${err.message}`); }
  }
  throw lastError || new Error("Geçerli soru üretilemedi.");
}

function normalizeIstekler(istekler, toplam) {
  const kaynak = Array.isArray(istekler) ? istekler : [];
  const out = []; let kalan = toplam;
  for (const x of kaynak) {
    if (kalan <= 0 || !x?.subject) continue;
    const count = Math.min(kalan, Math.max(1, Math.floor(Number(x.count) || 1)));
    out.push({subject:String(x.subject),topic:String(x.topic || "Karışık"),difficulty:String(x.difficulty || "orta"),count});
    kalan -= count;
  }
  if (!out.length) out.push({subject:"Türkçe",topic:"Karışık",difficulty:"orta",count:toplam});
  if (kalan > 0) out[out.length - 1].count += kalan;
  return out;
}

async function testUret(istekler, toplam) {
  toplam = Math.min(MAX_TEST, Math.max(1, Math.floor(Number(toplam) || 10)));
  const norm = normalizeIstekler(istekler, toplam);
  const paketler = [];
  let kalan = toplam;
  let offset = 0;
  while (kalan > 0) {
    const adet = Math.min(MAX_SORU_PAKET, kalan);
    const batch = norm.map(x => ({...x,count:0}));
    // Ders dağılımını koruyarak her pakete sırayla soru paylaştır.
    let cap = adet;
    for (const x of norm) {
      if (cap <= 0) break;
      const already = Math.min(x.count, offset);
      const available = Math.max(0, x.count - already);
      const take = Math.min(available, cap);
      if (take) { batch.find(b=>b.subject===x.subject && b.topic===x.topic).count += take; cap -= take; }
    }
    // dağıtımın sınırlarında boş kalırsa genel karışık paket kullan.
    if (batch.every(x=>x.count===0)) batch[0].count = adet;
    paketler.push(batch.filter(x=>x.count>0));
    offset += adet; kalan -= adet;
  }
  const all = []; const oncekiler=[];
  for (let i=0;i<paketler.length;i++) {
    console.log(`[ai/test] Paket ${i+1}/${paketler.length}: ${paketler[i].reduce((t,x)=>t+x.count,0)} soru.`);
    const qs = await paketUret(paketler[i], paketler[i].reduce((t,x)=>t+x.count,0), oncekiler);
    all.push(...qs); qs.forEach(q=>oncekiler.push(q.soru.slice(0,140)));
  }
  return all.slice(0,toplam);
}

router.post("/teacher", async (req,res) => {
  const soru = String(req.body?.soru || "").trim();
  if (!soru) return res.status(400).json({hata:"Lütfen bir soru yaz."});
  try {
    const cevap = await aiProvider.generate({
      system:"Sen KPSS Ortaöğretim öğrencisinin kişisel AI öğretmenisin. Türkçe, anlaşılır ve öğretici cevap ver. Gerektiğinde konuyu adım adım anlat, örnek ver ve en sonda kısa bir mini kontrol sorusu sor. Bilmediğin güncel bilgiyi kesinmiş gibi uydurma.",
      prompt:`Öğrencinin sorusu:\n${soru}`,
      jsonMode:false
    });
    return res.json({ok:true,cevap:String(cevap),kaynaklar:[],belirsiz:false});
  } catch (err) {
    console.error("[ai/teacher]",err.message);
    return res.status(503).json({hata:"AI Öğretmen şu anda cevap veremedi. Lütfen tekrar dene."});
  }
});

router.post("/generate-questions", async (req,res) => {
  try {
    const {subject,topic,difficulty,count} = req.body || {};
    const toplam = Math.min(MAX_TEST, Math.max(1, Math.floor(Number(count) || 10)));
    const sorular = await testUret([{subject:subject || "Türkçe",topic:topic || "Karışık",difficulty:difficulty || "orta",count:toplam}], toplam);
    if (sorular.length !== toplam) throw new Error(`Beklenen ${toplam}, üretilen ${sorular.length}.`);
    res.json({ok:true,sorular,soruSayisi:sorular.length});
  } catch(err) {
    console.error("[ai/generate-questions]",err.message);
    res.status(err.name === "AbortError" ? 504 : 503).json({hata:`${Number(req.body?.count)||10} soruluk test hazırlanamadı. Lütfen tekrar deneyin.`});
  }
});

router.post("/generate-mixed-test", async (req,res) => {
  try {
    const istekler = req.body?.istekler;
    if (!Array.isArray(istekler) || !istekler.length) return res.status(400).json({hata:"Ders ve konu bilgisi gönderilmedi."});
    const toplam = Math.min(MAX_SORU_PAKET, istekler.reduce((t,x)=>t+Math.max(0,Number(x.count)||0),0) || 5);
    const sorular = await testUret(istekler, toplam);
    res.json({ok:true,sorular});
  } catch(err) {
    console.error("[ai/generate-mixed-test]",err.message);
    res.status(503).json({hata:"Yapay zeka soru servisi şu anda kullanılamıyor. Lütfen tekrar deneyin."});
  }
});

router.post("/generate-mock-exam", async (req,res) => {
  try {
    const istekler = req.body?.istekler;
    if (!Array.isArray(istekler) || !istekler.length) return res.status(400).json({hata:"Deneme için ders ve konu bilgisi gönderilmedi."});
    console.log("[ai/generate-mock-exam] 20 soruluk deneme hazırlanıyor; 4 x 5 soru.");
    const sorular = await testUret(istekler, MOCK_EXAM_SORU);
    if (sorular.length !== MOCK_EXAM_SORU) throw new Error(`Deneme ${MOCK_EXAM_SORU} yerine ${sorular.length} soru üretti.`);
    console.log("[ai/generate-mock-exam] Deneme hazır: 20/20 soru.");
    res.json({ok:true,sorular,soruSayisi:sorular.length});
  } catch(err) {
    console.error("[ai/generate-mock-exam]",err.message);
    res.status(503).json({hata:"20 soruluk deneme şu anda hazırlanamadı. Lütfen tekrar deneyin."});
  }
});

router.post("/solve-image", async (req,res) => {
  try {
    const imageBase64 = String(req.body?.imageBase64 || "");
    const mimeType = String(req.body?.mimeType || "image/jpeg");
    if (!imageBase64) return res.status(400).json({hata:"Görsel gönderilmedi."});
    const content = await aiProvider.generateWithImage({
      system:"KPSS sorusunun görselini dikkatle oku. Yalnızca geçerli JSON döndür.",
      prompt:"Soruyu çöz ve şu JSON formatında cevap ver: {\"soru\":\"...\",\"secenekler\":{\"A\":\"...\",\"B\":\"...\",\"C\":\"...\",\"D\":\"...\",\"E\":\"...\"},\"dogruCevap\":\"A\",\"aciklama\":\"...\"}",
      imageBase64,mimeType
    });
    const parsed = temizJson(content);
    if (!parsed?.soru || !parsed?.dogruCevap) throw new Error("Görselden geçerli soru cevabı alınamadı.");
    res.json(parsed);
  } catch(err) {
    console.error("[ai/solve-image]",err.message);
    res.status(503).json({hata:"Fotoğraftaki soru şu anda çözülemedi. Daha net bir görsel deneyin."});
  }
});

router.get("/health", (req,res)=>res.json({ok:true,servis:"KPSS AI",sistem:"OpenRouter",modeller:modelListesi(),maksimumSoru:MAX_TEST,denemeSoru:MOCK_EXAM_SORU}));
module.exports = router;
