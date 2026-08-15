/* ==========================================================================
   services/providers/gemini.js
   Google Gemini API adaptörü. Diğer sağlayıcılar (ör. openai.js) aynı
   arayüzle (generate, generateWithImage) yazılıp aiProvider.js üzerinden
   AI_PROVIDER=... ortam değişkeniyle seçilebilir.
   ========================================================================== */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKeyKontrol() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("BURAYA")) {
    throw new Error("GEMINI_API_KEY tanımlı değil. Backend ortam değişkenlerini kontrol edin.");
  }
  return key;
}

/**
 * Metin tabanlı üretim.
 * @param {Object} p
 * @param {string} p.system - Sistem talimatı (AI'nın rolü/sınav odaklılığı).
 * @param {string} p.prompt - Kullanıcı mesajı / asıl istek.
 * @param {boolean} p.jsonMode - true ise modelden yalnızca JSON istenir.
 */
async function generate({ system, prompt, jsonMode = false }) {
  const key = apiKeyKontrol();
  const url = `${API_BASE}/${MODEL}:generateContent?key=${key}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: {
      temperature: 0.4,
      responseMimeType: jsonMode ? "application/json" : "text/plain"
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Gemini API hatası (${res.status}): ${hata}`);
  }

  const data = await res.json();
  const metin = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  if (!metin) throw new Error("Gemini boş yanıt döndürdü.");
  return metin;
}

/**
 * Görsel + metin (fotoğraftan soru çözme için).
 * @param {Object} p
 * @param {string} p.system
 * @param {string} p.prompt
 * @param {string} p.imageBase64 - "data:image/jpeg;base64,...." önekiyle veya çıplak base64.
 * @param {string} p.mimeType - örn. "image/jpeg"
 */
async function generateWithImage({ system, prompt, imageBase64, mimeType = "image/jpeg" }) {
  const key = apiKeyKontrol();
  const url = `${API_BASE}/${MODEL}:generateContent?key=${key}`;

  const temizVeri = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: temizVeri } }
        ]
      }
    ],
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const hata = await res.text();
    throw new Error(`Gemini Vision API hatası (${res.status}): ${hata}`);
  }

  const data = await res.json();
  const metin = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  if (!metin) throw new Error("Gemini boş yanıt döndürdü.");
  return metin;
}

module.exports = { generate, generateWithImage };
