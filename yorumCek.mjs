/**
 * RE/MAX DOĞUŞ — Yorum Toplayıcı (GitHub Actions + Playwright)
 * Ofis sayfasını ve danışman profillerini GERÇEK tarayıcıyla açar,
 * hem sayfadaki metinden hem de sitenin arka plan API cevaplarından
 * müşteri yorumlarını toplar, yorumlar.json dosyasına yazar.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const OFIS_URL = 'https://remax.com.tr/tr/ofis/detay/dogus';
const DANISMANLAR = [
  'Umut Tokkuş', 'Ayşegül Alpay', 'Aysun Yılmaz', 'Evşen Özazman', 'Gamze Yetkin',
  'Gizem Gök', 'İrem Aleyna Tetik', 'Orhan Özazman', 'Özlem Varol'
];

const norm = s => s.toLocaleLowerCase('tr')
  .replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ı/g,'i').replace(/i̇/g,'i')
  .replace(/ö/g,'o').replace(/ş/g,'s').replace(/ü/g,'u');

/* ---------- JSON içinde yorum objesi avı ---------- */
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

/* ---------- Görünür metinden yorum avı ---------- */
function metinYorumAv(metin, topla) {
  const re = /([^\n]{30,1500}?)\s*\/\s*Puan:\s*(\d)/g;
  let m;
  while ((m = re.exec(metin)) !== null) {
    topla.push({ musteri: '', tarih: '', puan: Number(m[2]), yorum: m[1].replace(/\s+/g, ' ').trim() });
  }
}

/* ---------- Bir sayfayı tarayıcıyla gez ---------- */
async function sayfaTara(browser, url, jsonHavuzu) {
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  page.on('response', async (res) => {
    try {
      const ct = (res.headers()['content-type'] || '');
      if (!ct.includes('json')) return;
      const veri = await res.json().catch(() => null);
      if (veri) jsonHavuzu.push({ url: res.url(), veri });
    } catch {}
  });

  console.log('>>', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Yorum sekmesi/başlığı varsa tıkla
  for (const desen of [/müşteri yorum/i, /yorumlar/i, /değerlendirme/i]) {
    try {
      const el = page.getByText(desen).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(2500);
      }
    } catch {}
  }

  // Sayfayı sonuna kadar kaydır (tembel yükleme) + "daha fazla" butonlarını tüket
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(600);
    try {
      const dahaFazla = page.getByRole('button', { name: /daha|devam|tümü|göster|more/i }).first();
      if (await dahaFazla.isVisible({ timeout: 500 }).catch(() => false)) {
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
}

/* ---------- ANA AKIŞ ---------- */
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const jsonHavuzu = [];
const hamYorumlar = []; // {kaynakAd|null, musteri, tarih, puan, yorum}

// 1) Ofis sayfası
const ofis = await sayfaTara(browser, OFIS_URL, jsonHavuzu);
{
  const t = [];
  metinYorumAv(ofis.metin, t);
  for (const j of jsonHavuzu) jsonYorumAv(j.veri, t);
  for (const y of t) hamYorumlar.push({ kaynakAd: null, ...y });
  console.log('Ofis sayfasından ham yorum:', t.length);
}

// 2) Ekip profilleri (ofis sayfasında görünen danışman linkleri)
const ekipLinkleri = [...new Set(ofis.linkler)]
  .filter(u => /\/danisman\/\d+\//.test(u))
  .slice(0, 15);
console.log('Bulunan danışman linki:', ekipLinkleri.length);

const sayilar = {}; // ad -> site yorum sayısı
for (const link of ekipLinkleri) {
  const oncekiJson = jsonHavuzu.length;
  const prof = await sayfaTara(browser, link, jsonHavuzu);

  // Bu profil kimin? Linkteki slug'ı kadromuzla eşle
  const slug = (link.match(/\/danisman\/\d+\/([a-z0-9-]+)/) || [])[1] || '';
  const sahibi = DANISMANLAR.find(ad => slug.includes(norm(ad).replace(/[^a-z0-9]+/g, '-'))) ||
                 DANISMANLAR.find(ad => prof.metin.includes(ad)) || null;

  const sy = prof.metin.match(/([\d.,]+)\s*Müşteri Yorumu/);
  if (sahibi && sy) sayilar[sahibi] = Number(sy[1].replace(/[.,]/g, ''));

  const t = [];
  metinYorumAv(prof.metin, t);
  for (const j of jsonHavuzu.slice(oncekiJson)) jsonYorumAv(j.veri, t);
  for (const y of t) hamYorumlar.push({ kaynakAd: sahibi, ...y });
  console.log('Profil:', sahibi || slug, '| yorum sayısı:', sy ? sy[1] : '-', '| ham yorum:', t.length);
}
await browser.close();

/* 3) Eşleme + tekilleştirme */
function kime(y) {
  if (y.kaynakAd) return y.kaynakAd;
  const m = ' ' + (y.yorum + ' ' + y.musteri).toLocaleLowerCase('tr') + ' ';
  let tam = null, kismi = null;
  for (const ad of DANISMANLAR) {
    const k = ad.toLocaleLowerCase('tr');
    if (m.includes(k)) { tam = ad; break; }
    const [ilk, ...rest] = k.split(' ');
    const son = rest.length ? rest[rest.length - 1] : null;
    if (m.includes(' ' + ilk + ' ') || (son && m.includes(' ' + son + ' '))) kismi = kismi || ad;
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

/* 4) Özet */
const ozet = DANISMANLAR.map(ad => ({
  ad,
  yorumSayisi: sayilar[ad] ?? yorumlar.filter(y => y.ad === ad).length
}));

const cikti = {
  guncelleme: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  ozet,
  yorumlar
};
fs.writeFileSync('yorumlar.json', JSON.stringify(cikti, null, 2));
console.log('BİTTİ — toplam yorum:', yorumlar.length, '| özet:', JSON.stringify(ozet));
