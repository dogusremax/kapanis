/**
 * RE/MAX DOĞUŞ — Yorum Toplayıcı v2 (GitHub Actions + Playwright)
 * Her durumda yorumlar.json yazar; hata olursa hatayı da dosyaya koyar
 * (uzaktan teşhis için).
 */
import fs from 'fs';

const OFIS_URL = 'https://remax.com.tr/tr/ofis/detay/dogus';
const DANISMANLAR = [
  'Umut Tokkuş', 'Ayşegül Alpay', 'Aysun Yılmaz', 'Evşen Özazman', 'Gamze Yetkin',
  'Gizem Gök', 'İrem Aleyna Tetik', 'Orhan Özazman', 'Özlem Varol'
];

const debug = { hatalar: [], notlar: [] };
const hamYorumlar = [];
const sayilar = {};
let ofisMetinOrnek = '';

const norm = s => s.toLocaleLowerCase('tr')
  .replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/i̇/g,'i')
  .replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u');

function jsonYorumAv(dugum, topla, derinlik = 0) {
  if (derinlik > 16 || dugum == null || typeof dugum !== 'object') return;
  if (Array.isArray(dugum)) { for (const x of dugum) jsonYorumAv(x, topla, derinlik + 1); return; }
  const keys = Object.keys(dugum);
  const yorumK = keys.find(k => /comment|review|yorum|message|feedback|text|description/i.test(k) && typeof dugum[k] === 'string' && dugum[k].length > 25);
  const isimK  = keys.find(k => /name|musteri|customer|fullname|author/i.test(k) && typeof dugum[k] === 'string' && dugum[k].length < 60);
  if (yorumK && isimK) {
    const tarihK = keys.find(k => /date|tarih|created/i.test(k));
    const puanK  = keys.find(k => /rate|rating|puan|score|star/i.test(k) && (typeof dugum[k] === 'number' || /^\d$/.test(String(dugum[k]))));
    topla.push({
      musteri: String(dugum[isimK]).trim(),
      tarih: tarihK ? String(dugum[tarihK]).slice(0, 10) : '',
      puan: puanK ? Number(dugum[puanK]) : null,
      yorum: String(dugum[yorumK]).replace(/\s+/g, ' ').trim().slice(0, 1500)
    });
    return;
  }
  for (const k of keys) jsonYorumAv(dugum[k], topla, derinlik + 1);
}

function metinYorumAv(metin, topla) {
  const re = /([^\n]{30,1500}?)\s*\/\s*Puan:\s*(\d)/g;
  let m;
  while ((m = re.exec(metin)) !== null) {
    topla.push({ musteri: '', tarih: '', puan: Number(m[2]), yorum: m[1].replace(/\s+/g, ' ').trim() });
  }
}

async function ana() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    debug.hatalar.push('playwright import: ' + e.message);
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  } catch (e) {
    debug.hatalar.push('tarayıcı açılamadı: ' + e.message);
    return;
  }

  const jsonHavuzu = [];

  async function sayfaTara(url) {
    let page;
    try {
      page = await browser.newPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
      page.on('response', async (res) => {
        try {
          if (!(res.headers()['content-type'] || '').includes('json')) return;
          const veri = await res.json().catch(() => null);
          if (veri) jsonHavuzu.push({ url: res.url(), veri });
        } catch {}
      });
      console.log('>>', url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);

      for (const desen of [/müşteri yorum/i, /yorumlar/i, /değerlendirme/i]) {
        try {
          const el = page.getByText(desen).first();
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            await el.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(2500);
          }
        } catch {}
      }
      for (let i = 0; i < 25; i++) {
        await page.mouse.wheel(0, 2200).catch(() => {});
        await page.waitForTimeout(500);
        try {
          const dahaFazla = page.getByRole('button', { name: /daha|devam|tümü|göster|more/i }).first();
          if (await dahaFazla.isVisible({ timeout: 400 }).catch(() => false)) {
            await dahaFazla.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(1200);
          }
        } catch {}
      }
      await page.waitForTimeout(1500);
      const metin = await page.evaluate(() => document.body.innerText).catch(() => '');
      const linkler = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/danisman/"]')).map(a => a.href)
      ).catch(() => []);
      await page.close();
      return { metin, linkler };
    } catch (e) {
      debug.hatalar.push('sayfa (' + url + '): ' + e.message);
      try { if (page) await page.close(); } catch {}
      return { metin: '', linkler: [] };
    }
  }

  // 1) Ofis sayfası
  const ofis = await sayfaTara(OFIS_URL);
  ofisMetinOrnek = ofis.metin.slice(0, 1200);
  {
    const t = [];
    metinYorumAv(ofis.metin, t);
    for (const j of jsonHavuzu) jsonYorumAv(j.veri, t);
    for (const y of t) hamYorumlar.push({ kaynakAd: null, ...y });
    console.log('Ofis sayfasından ham yorum:', t.length);
    debug.notlar.push('ofis ham yorum: ' + t.length + ' | metin uzunluğu: ' + ofis.metin.length + ' | json cevap: ' + jsonHavuzu.length);
  }

  // 2) Ekip profilleri
  const ekipLinkleri = [...new Set(ofis.linkler)].filter(u => /\/danisman\/\d+\//.test(u)).slice(0, 15);
  console.log('Bulunan danışman linki:', ekipLinkleri.length);
  debug.notlar.push('danışman linki: ' + ekipLinkleri.length);

  for (const link of ekipLinkleri) {
    const oncekiJson = jsonHavuzu.length;
    const prof = await sayfaTara(link);
    const slug = (link.match(/\/danisman\/\d+\/([a-z0-9-]+)/) || [])[1] || '';
    const sahibi = DANISMANLAR.find(ad => slug.includes(norm(ad).replace(/[^a-z0-9]+/g, '-'))) ||
                   DANISMANLAR.find(ad => prof.metin.includes(ad)) || null;
    const sy = prof.metin.match(/([\d.,]+)\s*Müşteri Yorumu/);
    if (sahibi && sy) sayilar[sahibi] = Number(sy[1].replace(/[.,]/g, ''));
    const t = [];
    metinYorumAv(prof.metin, t);
    for (const j of jsonHavuzu.slice(oncekiJson)) jsonYorumAv(j.veri, t);
    for (const y of t) hamYorumlar.push({ kaynakAd: sahibi, ...y });
    console.log('Profil:', sahibi || slug, '| sayı:', sy ? sy[1] : '-', '| ham yorum:', t.length);
  }

  try { await browser.close(); } catch {}
}

try { await ana(); } catch (e) { debug.hatalar.push('genel: ' + (e && e.message || e)); }

/* Eşleme + tekilleştirme + yazım — HER DURUMDA çalışır */
function kime(y) {
  if (y.kaynakAd) return y.kaynakAd;
  const m = ' ' + (y.yorum + ' ' + y.musteri).toLocaleLowerCase('tr') + ' ';
  let tam = null, kismi = null;
  for (const ad of DANISMANLAR) {
    const k = ad.toLocaleLowerCase('tr');
    if (m.includes(k)) { tam = ad; break; }
    const parca = k.split(' ');
    const ilk = parca[0], son = parca[parca.length - 1];
    if (m.includes(' ' + ilk + ' ') || m.includes(' ' + son + ' ')) kismi = kismi || ad;
  }
  return tam || kismi || 'Ofis';
}

const gorulen = new Set();
const yorumlar = [];
for (const y of hamYorumlar) {
  const anahtar = y.yorum.slice(0, 90);
  if (gorulen.has(anahtar) || y.yorum.length < 25) continue;
  gorulen.add(anahtar);
  yorumlar.push({
    ad: kime(y),
    musteri: y.musteri || '',
    tarih: y.tarih || '',
    yorum: y.yorum + (y.puan ? ` (Puan: ${y.puan}/5)` : '')
  });
}

const cikti = {
  guncelleme: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  ozet: DANISMANLAR.map(ad => ({ ad, yorumSayisi: sayilar[ad] ?? yorumlar.filter(y => y.ad === ad).length })),
  yorumlar,
  debug: { ...debug, ofisMetinOrnek }
};
fs.writeFileSync('yorumlar.json', JSON.stringify(cikti, null, 2));
console.log('BİTTİ — toplam yorum:', yorumlar.length, '| hata:', debug.hatalar.length);
