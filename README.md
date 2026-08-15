# KPSS 2026 Backend — Kurulum ve Yayına Alma Rehberi

Bu klasör, mobil/web uygulamanın **yapay zeka, web arama ve güncel bilgi**
özellikleri için kullandığı sunucudur. API anahtarların burada saklanır,
uygulamanın kendisine (APK/AAB) **asla gömülmez**.

## 1. Gemini API anahtarı al (ücretsiz katmanı var)

1. https://aistudio.google.com/apikey adresine git.
2. Google hesabınla giriş yap → "Create API key" de.
3. Oluşan anahtarı kopyala (bu senin `GEMINI_API_KEY`'in).

## 2. Web arama anahtarı al (güncel bilgi için)

1. https://programmablesearchengine.google.com/ → "Add" ile yeni bir arama motoru oluştur, "tüm interneti ara" seçeneğini işaretle. Oluşunca **CX** kodunu kopyala (`GOOGLE_SEARCH_CX`).
2. https://console.cloud.google.com/apis/library/customsearch.googleapis.com adresinden "Custom Search API"yi etkinleştir, bir API anahtarı oluştur (`GOOGLE_SEARCH_API_KEY`).
   - Ücretsiz katman: günde 100 arama. Aşarsa `webSearch.js` boş sonuç döner, uygulama çökmez.

> Bu adımı atlarsan uygulama yine çalışır; sadece güncel bilgi/arama özellikleri
> "güncel bilgi alınamadı" mesajı gösterir, AI Öğretmen genel bilgiyle cevap verir.

## 3. Yerelde deneme (isteğe bağlı)

```bash
cd kpss-backend
npm install
cp .env.example .env
# .env dosyasını aç, GEMINI_API_KEY ve diğer anahtarları yapıştır
npm start
```

Tarayıcıda `http://localhost:3000/health` açıp `{"ok":true}` görürsen çalışıyordur.

## 4. Ücretsiz olarak internete açma (Railway örneği)

1. https://railway.app → GitHub hesabınla giriş yap.
2. Bu `kpss-backend` klasörünü kendi GitHub reponuza yükle (veya Railway'in
   "Deploy from GitHub repo" adımını izle).
3. Railway projesine "New Project → Deploy from GitHub repo" ile bu repoyu seç.
4. **Variables** (ortam değişkenleri) sekmesine `.env.example` içindeki
   her satırı tek tek ekle — gerçek anahtarlarınla.
5. Deploy tamamlanınca Railway sana bir adres verir, örn:
   `https://kpss-backend-production.up.railway.app`
6. Bu adresi frontend'deki Ayarlar sayfasında "Sunucu Adresi (API_BASE_URL)"
   alanına yapıştır.

(Render.com da aynı mantıkla çalışır: "New Web Service" → repo seç →
Environment Variables gir → deploy.)

## 5. Admin paneli nasıl kullanılır?

Şu an ayrı bir görsel admin ekranı yok; uçlar hazır, `X-Admin-Token` header'ı
ile korunuyor (`.env` içindeki `ADMIN_TOKEN`). Örnek:

```bash
curl -X GET https://SUNUCU_ADRESIN/api/admin/reported-questions \
  -H "X-Admin-Token: senin-admin-tokenin"
```

İstersen bir sonraki aşamada bu uçları kullanan basit bir web admin ekranı
(HTML sayfası) da ekleyebilirim.

## 6. Güvenlik kontrol listesi

- [x] API anahtarları yalnızca sunucu ortam değişkenlerinde
- [x] `.env` dosyası git'e eklenmemeli (`.gitignore` dosyasını oluştur, içine `.env` ve `data/` yaz)
- [x] Frontend kodu API anahtarı içermiyor, sadece `API_BASE_URL` (herkese açık olabilir, sorun değil)
- [x] Günlük istek limiti var (ücretsiz kullanıcı kötüye kullanamaz)
- [ ] Canlıya alınca `ALLOWED_ORIGIN` değerini `*` yerine gerçek domain'e daralt
