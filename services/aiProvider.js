/* ==========================================================================
   services/aiProvider.js
   KPSS 2026 - OpenRouter AI Provider
   ========================================================================== */

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/* --------------------------------------------------------------------------
   API KEY
   -------------------------------------------------------------------------- */

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY Railway Variables bölümünde tanımlı değil."
    );
  }

  return key;
}

/* --------------------------------------------------------------------------
   MODEL
   -------------------------------------------------------------------------- */

function getModel() {
  return process.env.OPENROUTER_MODEL || "openrouter/free";
}

/* --------------------------------------------------------------------------
   OPENROUTER İSTEĞİ
   -------------------------------------------------------------------------- */

async function openRouterRequest(body) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",

    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(
      "[OpenRouter API Hatası]",
      response.status,
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      `OpenRouter API hatası: ${response.status}`
    );
  }

  return data;
}

/* --------------------------------------------------------------------------
   NORMAL AI İSTEĞİ
   -------------------------------------------------------------------------- */

async function generate({
  system,
  prompt,
  jsonMode = false
}) {
  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: String(system)
    });
  }

  messages.push({
    role: "user",
    content: String(prompt)
  });

  const body = {
    model: getModel(),

    messages,

    temperature: 0.3
  };

  /*
   * JSON gerekiyorsa OpenAI uyumlu response_format kullanıyoruz.
   * openrouter/free gerekli özelliği destekleyen ücretsiz modeli
   * seçebildiği için burada kullanılabilir.
   */
  if (jsonMode) {
    body.response_format = {
      type: "json_object"
    };
  }

  const data = await openRouterRequest(body);

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error(
      "[OpenRouter] Boş cevap:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "OpenRouter AI boş cevap döndürdü."
    );
  }

  return content;
}

/* --------------------------------------------------------------------------
   GÖRSEL + AI
   KPSS soru fotoğrafı çözme özelliği
   -------------------------------------------------------------------------- */

async function generateWithImage({
  system,
  prompt,
  imageBase64,
  mimeType = "image/jpeg"
}) {
  if (!imageBase64) {
    throw new Error(
      "Görsel verisi gönderilmedi."
    );
  }

  const imageDataUrl =
    `data:${mimeType};base64,${imageBase64}`;

  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: String(system)
    });
  }

  messages.push({
    role: "user",

    content: [
      {
        type: "text",
        text: String(prompt)
      },

      {
        type: "image_url",

        image_url: {
          url: imageDataUrl
        }
      }
    ]
  });

  const body = {
    model: getModel(),

    messages,

    temperature: 0.2,

    response_format: {
      type: "json_object"
    }
  };

  const data = await openRouterRequest(body);

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error(
      "[OpenRouter Görsel] Boş cevap:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "OpenRouter görsel isteğinde boş cevap döndürdü."
    );
  }

  return content;
}

/* --------------------------------------------------------------------------
   EXPORT
   -------------------------------------------------------------------------- */

module.exports = {
  generate,
  generateWithImage
};
