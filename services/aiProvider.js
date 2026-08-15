/* ==========================================================================
   services/aiProvider.js
   Uygulamanın geri kalanı DOĞRUDAN gemini.js'i çağırmaz; bu dosyayı çağırır.
   Yeni bir sağlayıcı eklemek için:
     1) services/providers/openai.js dosyasını aynı arayüzle (generate,
        generateWithImage) yaz.
     2) Aşağıdaki PROVIDERS listesine ekle.
     3) .env içinde AI_PROVIDER=openai yap.
   Kod tabanının başka hiçbir yerini değiştirmen gerekmez.
   ========================================================================== */

const gemini = require("./providers/gemini");

const PROVIDERS = {
  gemini
  // openai: require("./providers/openai"),
};

function aktifSaglayici() {
  const secili = process.env.AI_PROVIDER || "gemini";
  const saglayici = PROVIDERS[secili];
  if (!saglayici) {
    throw new Error(`Bilinmeyen AI_PROVIDER: "${secili}". Geçerli seçenekler: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return saglayici;
}

async function generate(params) {
  return aktifSaglayici().generate(params);
}

async function generateWithImage(params) {
  return aktifSaglayici().generateWithImage(params);
}

module.exports = { generate, generateWithImage };
