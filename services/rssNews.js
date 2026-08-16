const RSS_FEEDS={
  "Türkiye":"https://www.trthaber.com/turkiye_articles.rss",
  "Dünya":"https://www.trthaber.com/dunya_articles.rss",
  "Ekonomi":"https://www.trthaber.com/ekonomi_articles.rss",
  "Bilim":"https://www.trthaber.com/bilim_teknoloji_articles.rss",
  "Teknoloji":"https://www.trthaber.com/bilim_teknoloji_articles.rss",
  "Kültür-Sanat":"https://www.trthaber.com/kultur_sanat_articles.rss",
  "Spor":"https://www.trthaber.com/spor_articles.rss",
  "Kamu Kurumları":"https://www.trthaber.com/guncel_articles.rss",
  "Önemli Atamalar":"https://www.trthaber.com/guncel_articles.rss",
  "Tarih":"https://www.trthaber.com/guncel_articles.rss",
  "Önemli Günler":"https://www.trthaber.com/guncel_articles.rss",
  "Uluslararası Kuruluşlar":"https://www.aa.com.tr/tr/rss/default?cat=guncel",
  "Ödüller":"https://www.aa.com.tr/tr/rss/default?cat=aktuel",
  "Coğrafya":"https://www.aa.com.tr/tr/rss/default?cat=guncel"
};
function unescapeXml(s){return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
function firstTag(xml,tag){const m=xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,`i`));return m?unescapeXml(m[1]):"";}
async function feedGetir(url,limit=6){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{headers:{"User-Agent":"KPSS-2026/1.0"},signal:controller.signal});if(!r.ok)return[];const xml=await r.text();const items=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];return items.slice(0,limit).map(item=>{const title=firstTag(item,"title"),description=firstTag(item,"description"),link=firstTag(item,"link"),pub=firstTag(item,"pubDate")||firstTag(item,"published")||firstTag(item,"updated");return title?{baslik:title,url:link,kaynak:"TRT Haber / Anadolu Ajansı RSS",tarih:pub?new Date(pub).toISOString():null,icerikOzeti:description}:null}).filter(Boolean);}catch(e){console.error("[rssNews]",url,e.message);return[]}finally{clearTimeout(timer)}}
async function rssGuncelGetir(kategori,limit=6){const url=RSS_FEEDS[kategori];return url?feedGetir(url,limit):[];}
module.exports={rssGuncelGetir,RSS_FEEDS};
