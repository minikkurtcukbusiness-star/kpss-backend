/* ==========================================================================
   services/aiProvider.js
   OpenRouter AI sağlayıcısı
   ========================================================================== */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error("OPENROUTER_API_KEY tanımlı değil.");
  }

  return key;
}

function getModel() {
  return process.env.OPENROUTER_MODEL || "openrouter/free";
}

/**
 * Normal metin üretimi
 */
async function generate({ system, prompt, jsonMode = false }) {
  const body = {
    model: getModel(),
    messages: [
      {
        role: "system",
        content: system || "Sen yardımcı bir asistansın."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.4
  };

  if (jsonMode) {
    body.response_format = {
      type: "json_object"
    };
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kpss-backend-production.up.railway.app",
      "X-Title": "KPSS 2026 Ortaöğretim"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[OpenRouter API Hatası]", response.status, data);
    throw new Error(
      data?.error?.message ||
      `OpenRouter API hatası: ${response.status}`
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter boş cevap döndürdü.");
  }

  return content;
}

/**
 * Görsel + metin ile AI kullanımı
 * KPSS soru fotoğrafı çözme özelliği için.
 */
async function generateWithImage({
  system,
  prompt,
  imageBase64,
  mimeType = "image/jpeg"
}) {
  const body = {
    model: getModel(),
    messages: [
      {
        role: "system",
        content: system || "Sen yardımcı bir asistansın."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`
            }
          }
        ]
      },
      {
        role: "user",
        content: "Yalnızca istenen JSON formatında cevap ver."
      }
    ],
    temperature: 0.2,
    response_format: {
      type: "json_object"
    }
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kpss-backend-production.up.railway.app",
      "X-Title": "KPSS 2026 Ortaöğretim"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(
      "[OpenRouter Görsel API Hatası]",
      response.status,
      data
    );

    throw new Error(
      data?.error?.message ||
      `OpenRouter API hatası: ${response.status}`
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter boş görsel cevabı döndürdü.");
  }

  return content;
}

module.exports = {
  generate,
  generateWithImage
};
