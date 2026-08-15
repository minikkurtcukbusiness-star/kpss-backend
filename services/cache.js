/* ==========================================================================
   services/cache.js
   Aynı sorgunun tekrar tekrar arama/AI çağrısına yol açmaması için
   basit, süre (TTL) bazlı bellek-içi önbellek.
   Not: Sunucu yeniden başlarsa önbellek sıfırlanır — tek sunuculu küçük
   ölçekli kullanım için yeterlidir. Büyürse Redis'e taşınabilir.
   ========================================================================== */

const store = new Map();

const TTL_MS = (Number(process.env.CACHE_TTL_MINUTES) || 60) * 60 * 1000;

function get(key) {
  const gecerli = store.get(key);
  if (!gecerli) return null;
  if (Date.now() > gecerli.sonaErme) {
    store.delete(key);
    return null;
  }
  return gecerli.veri;
}

function set(key, veri, ozelTtlMs) {
  store.set(key, {
    veri,
    sonaErme: Date.now() + (ozelTtlMs || TTL_MS)
  });
}

function temizle(key) {
  store.delete(key);
}

module.exports = { get, set, temizle };
