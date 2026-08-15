/* ==========================================================================
   config/sources.js
   KPSS güncel bilgileri için güven sırasına göre resmi/güvenilir kaynaklar.
   Arama sonuçları bu listeye göre önceliklendirilir (öncelik ne kadar
   küçükse o kadar güvenilir kabul edilir).
   ========================================================================== */

const TRUSTED_DOMAINS = [
  // Sınav ve devlet kurumu (en yüksek öncelik)
  { domain: "osym.gov.tr", ad: "ÖSYM", oncelik: 1 },
  { domain: "resmigazete.gov.tr", ad: "Resmî Gazete", oncelik: 1 },
  { domain: "tbmm.gov.tr", ad: "TBMM", oncelik: 1 },
  { domain: "tccb.gov.tr", ad: "Cumhurbaşkanlığı", oncelik: 1 },
  { domain: "tuik.gov.tr", ad: "TÜİK", oncelik: 1 },
  { domain: "tcmb.gov.tr", ad: "Türkiye Cumhuriyet Merkez Bankası", oncelik: 1 },
  { domain: "meb.gov.tr", ad: "Millî Eğitim Bakanlığı", oncelik: 1 },
  { domain: "gov.tr", ad: "Türkiye Cumhuriyeti Resmî Kurumları", oncelik: 2 },

  // Uluslararası resmi kuruluşlar
  { domain: "un.org", ad: "Birleşmiş Milletler", oncelik: 2 },
  { domain: "nato.int", ad: "NATO", oncelik: 2 },
  { domain: "europa.eu", ad: "Avrupa Birliği", oncelik: 2 },
  { domain: "unesco.org", ad: "UNESCO", oncelik: 2 },
  { domain: "who.int", ad: "Dünya Sağlık Örgütü (WHO)", oncelik: 2 },

  // Doğrulama amaçlı, birden fazla kaynakla teyit edilerek kullanılacak haber siteleri
  { domain: "aa.com.tr", ad: "Anadolu Ajansı", oncelik: 3 },
  { domain: "trthaber.com", ad: "TRT Haber", oncelik: 3 }
];

// AI'nın önceliklendirmesi için düz domain listesi
const TRUSTED_DOMAIN_LIST = TRUSTED_DOMAINS.map(s => s.domain);

// "Güncel Bilgiler" sayfasındaki kategoriler ve her biri için arama sorgu şablonları.
// %TARIH% çalışma zamanında güncel tarihle değiştirilir.
const CURRENT_AFFAIRS_CATEGORIES = [
  { id: "turkiye", ad: "Türkiye", sorgu: "Türkiye gündem %TARIH%" },
  { id: "dunya", ad: "Dünya", sorgu: "dünya gündemi %TARIH%" },
  { id: "ekonomi", ad: "Ekonomi", sorgu: "Türkiye ekonomi gündemi %TARIH%" },
  { id: "bilim", ad: "Bilim", sorgu: "bilim güncel gelişmeler %TARIH%" },
  { id: "teknoloji", ad: "Teknoloji", sorgu: "teknoloji güncel gelişmeler %TARIH%" },
  { id: "kultur_sanat", ad: "Kültür-Sanat", sorgu: "kültür sanat gündemi Türkiye %TARIH%" },
  { id: "spor", ad: "Spor", sorgu: "spor gündemi Türkiye %TARIH%" },
  { id: "uluslararasi_kuruluslar", ad: "Uluslararası Kuruluşlar", sorgu: "NATO BM AB güncel gelişme %TARIH%" },
  { id: "atamalar", ad: "Önemli Atamalar", sorgu: "Türkiye önemli atama %TARIH%" },
  { id: "odul", ad: "Ödüller", sorgu: "önemli ödül kazananlar %TARIH%" },
  { id: "onemli_gunler", ad: "Önemli Günler", sorgu: "bugün önemli gün ve haftalar %TARIH%" },
  { id: "cografya", ad: "Coğrafya", sorgu: "Türkiye coğrafya güncel gelişme %TARIH%" },
  { id: "tarih", ad: "Tarih", sorgu: "tarihte bugün %TARIH%" },
  { id: "kamu_kurumlari", ad: "Kamu Kurumları", sorgu: "kamu kurumu düzenleme mevzuat %TARIH%" }
];

module.exports = { TRUSTED_DOMAINS, TRUSTED_DOMAIN_LIST, CURRENT_AFFAIRS_CATEGORIES };
