const express = require("express");
const { nanoid } = require("nanoid");
const searchWeb = require("../services/webSearch").searchWeb;
const aiProvider = require("../services/aiProvider");
const cache = require("../services/cache");
const db = require("../db/db");
const { CURRENT_AFFAIRS_CATEGORIES } = require("../config/sources");
const { aiRateLimit } = require("../middleware/rateLimit");
const router = express.Router();

function bugunISO(){return new Date().toISOString().slice(0,10);}
function guvenliJson(m){if(!m||typeof m!=="string")return null;let x=m.replace(/```json|```/g,"").trim();try{return JSON.parse(x)}catch(_){}const a=Math.min(...[x.indexOf("["),x.indexOf("{")].filter(i=>i>=0));if(!Number.isFinite(a))return null;const open=x[a],close=open==="["?"]":"}";let d=0,s=false,e=false;for(let i=a;i<x.length;i++){const c=x[i];if(e){e=false;continue}if(c==="\\"&&s){e=true;continue}if(c==='"'){s=!s;continue}if(s)continue;if(c===open)d++;if(c===close&&--d===0){try{return JSON.parse(x.slice(a,i+1))}catch(_){return null}}}return null;}
function tarihGecerliMi(iso,maxGun=30){if(!iso)return true;const t=new Date(iso);if(Number.isNaN(t.getTime()))return true;return (Date.now()-t.getTime())/(86400000)<=maxGun;}
function satirdanNesneyeCevir(s){const kaynaklar=db.prepare("SELECT title,url,domain FROM sources WHERE current_affairs_id=?").all(s.id);return {id:s.id,baslik:s.title,ozet:s.summary,kategori:s.category,tarih:s.published_at,kaynakAdi:s.source_name,kaynakUrl:s.source_url,tumKaynaklar:kaynaklar};}

async function gununGuncelBilgileriniUret(force=false){
  const bugun=bugunISO(), key=`current-affairs:${bugun}`;
  if(!force){const c=cache.get(key);if(c)return c;const dbRows=db.prepare("SELECT * FROM current_affairs WHERE published_at=? ORDER BY rowid DESC LIMIT 30").all(bugun);if(dbRows.length){const result=dbRows.map(satirdanNesneyeCevir);cache.set(key,result);return result;}}
  const mevcutBasliklar=db.prepare("SELECT title FROM current_affairs WHERE published_at=?").all(bugun).map(x=>x.title);
  const kategoriler=[...CURRENT_AFFAIRS_CATEGORIES].sort(()=>Math.random()-0.5).slice(0,force?8:CURRENT_AFFAIRS_CATEGORIES.length);
  const uretilen=[];
  for(const kategori of kategoriler){
    try{
      const sorgu=kategori.sorgu.replace("%TARIH%",bugun);
      const kaynaklar=(await searchWeb(sorgu,{onlyTrusted:true,limit:4})).filter(k=>tarihGecerliMi(k.tarih));
      if(!kaynaklar.length)continue;
      const kaynakMetni=kaynaklar.map((k,i)=>`[${i+1}] ${k.baslik} (${k.kaynak}, ${k.tarih||"tarih yok"}) — ${k.icerikOzeti}`).join("\n");
      const text=await aiProvider.generate({system:"KPSS güncel bilgi editörüsün. Yalnızca geçerli JSON ver.",prompt:`Kategori: ${kategori.ad}\nTarih: ${bugun}\nKaynaklar:\n${kaynakMetni}\n\nBugünün sınav odaklı 1-2 yeni bilgi kartını çıkar. Önceden kullanılan başlıklara benzer veya aynı içerik üretme: ${mevcutBasliklar.slice(-30).join(" | ")}\nFormat: [{"baslik":"...","ozet":"..."}]`,jsonMode:true});
      const kartlar=guvenliJson(text)||[];const arr=Array.isArray(kartlar)?kartlar:(Array.isArray(kartlar.bilgiler)?kartlar.bilgiler:[]);
      for(const kart of arr){if(!kart?.baslik||!kart?.ozet)continue;if(mevcutBasliklar.includes(kart.baslik))continue;const id=nanoid(),src=kaynaklar[0];db.prepare("INSERT INTO current_affairs (id,title,summary,category,published_at,source_name,source_url,content) VALUES (?,?,?,?,?,?,?,?)").run(id,kart.baslik,kart.ozet,kategori.ad,bugun,src.kaynak,src.url,kaynakMetni);for(const k of kaynaklar)db.prepare("INSERT INTO sources (id,current_affairs_id,title,url,domain) VALUES (?,?,?,?,?)").run(nanoid(),id,k.baslik,k.url,k.kaynak);uretilen.push({id,baslik:kart.baslik,ozet:kart.ozet,kategori:kategori.ad,tarih:bugun,kaynakAdi:src.kaynak,kaynakUrl:src.url});mevcutBasliklar.push(kart.baslik);}
    }catch(err){console.error(`[current-affairs] ${kategori.ad}:`,err.message)}
  }
  const result=uretilen.length?uretilen:db.prepare("SELECT * FROM current_affairs WHERE published_at=? ORDER BY rowid DESC LIMIT 30").all(bugun).map(satirdanNesneyeCevir);
  cache.set(key,result);return result;
}

router.get("/today",async(req,res)=>{try{const force=String(req.query.refresh||"")==="1";const bilgiler=await gununGuncelBilgileriniUret(force);res.json({tarih:bugunISO(),yenilendi:force,bilgiler});}catch(err){console.error("[current-affairs/today]",err.message);res.status(503).json({hata:"Güncel bilgi alınamadı. Lütfen daha sonra tekrar deneyin."});}});

router.post("/quiz",aiRateLimit,async(req,res)=>{try{const bilgiler=await gununGuncelBilgileriniUret(false);if(!bilgiler.length)return res.status(503).json({hata:"Bugün için yeterli güncel bilgi bulunamadı."});const bilgiMetni=bilgiler.slice(0,10).map((b,i)=>`${i+1}. [${b.kategori}] ${b.baslik}: ${b.ozet}`).join("\n");const text=await aiProvider.generate({system:"KPSS güncel bilgiler testi hazırlayan soru yazarısın. Yalnızca JSON ver.",prompt:`Aşağıdaki bilgilerden ${Math.min(10,bilgiler.length)} özgün çoktan seçmeli soru üret. Her biri A-E seçenekli, tek doğru cevaplı ve açıklamalı olsun.\n${bilgiMetni}\nFormat: {"sorular":[{"soru":"...","secenekler":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"dogruCevap":"A","aciklama":"..."}]}`,jsonMode:true});const parsed=guvenliJson(text)||{};const sorular=Array.isArray(parsed)?parsed:(parsed.sorular||[]);res.json({tarih:bugunISO(),sorular});}catch(err){console.error("[current-affairs/quiz]",err.message);res.status(503).json({hata:"Bugünün testi oluşturulamadı. Lütfen tekrar deneyin."});}});
module.exports=router;
