/* ==========================================================================
   services/webSearch.js
   Gerçek web araması yapan, sonucu standart bir formata çeviren servis.
   Google Programmable Search Engine (Custom Search JSON API) kullanır.

   Neden bu API? Ücretsiz katmanı var (günlük 100 sorgu), belirli sitelerle
   sınırlandırılabilir (örn. sadece gov.tr, un.org...) ve kurulumu basit.
   İstenirse başka bir arama sağlayıcısıyla (Bing, SerpAPI vb.) burada
   searchWeb() fonksiyonunun içini değiştirerek kolayca yer değiştirilebilir.
   ========================================================================== */

const cache = require("./cache");
const { TRUSTED_DOMAIN_LIST } = require("../config/sources");

async function searchWeb(query, { onlyTrusted = false, limit = 5 } = {}) {
  if (!query || !query.trim()) return [];

  const cacheKey = `search:${onlyTrusted ? "trusted:" : ""}${query.toLowerCase()}`;
  const onbellek = cache.get(cacheKey);
  if (onbellek) return onbellek;

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || apiKey.includes("BURAYA") || !cx || cx.includes("BURAYA")) {
    // Arama anahtarları henüz girilmemiş — uygulamayı çökertme, boş dön.
    console.warn("[webSearch] GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_CX tanımlı değil.");
    return [];
  }

  const siteKisiti = onlyTrusted
    ? " " + TRUSTED_DOMAIN_LIST.map(d => `site:${d}`).join(" OR ")
    : "";

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query + siteKisiti);
  url.searchParams.set("num", String(Math.min(limit, 10)));
  url.searchParams.set("hl", "tr");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error("[webSearch] Arama API hatası:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    const sonuclar = (data.items || []).map(item => ({
      baslik: item.title,
      url: item.link,
      kaynak: item.displayLink,
      tarih:
        item.pagemap?.metatags?.[0]?.["article:published_time"] ||
        item.pagemap?.metatags?.[0]?.["og:updated_time"] ||
        null,
      icerikOzeti: item.snippet
    }));

    // Güvenilir domainleri öne al
    sonuclar.sort((a, b) => {
      const aGuvenilir = TRUSTED_DOMAIN_LIST.some(d => a.kaynak.includes(d)) ? 0 : 1;
      const bGuvenilir = TRUSTED_DOMAIN_LIST.some(d => b.kaynak.includes(d)) ? 0 : 1;
      return aGuvenilir - bGuvenilir;
    });

    cache.set(cacheKey, sonuclar);
    return sonuclar;
  } catch (err) {
    console.error("[webSearch] İstek başarısız:", err.message);
    return [];
  }
}

module.exports = { searchWeb };
