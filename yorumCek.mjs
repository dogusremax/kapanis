/** RE/MAX DOĞUŞ — Yorum Toplayıcı v3 (sekme tıklama + sayfalama + zengin teşhis) */
import fs from 'fs';

const OFIS_URL = 'https://remax.com.tr/tr/ofis/detay/dogus';
const DANISMANLAR = [
  'Umut Tokkuş', 'Ayşegül Alpay', 'Aysun Yılmaz', 'Evşen Özazman', 'Gamze Yetkin',
  'Gizem Gök', 'İrem Aleyna Tetik', 'Orhan Özazman', 'Özlem Varol'
];

const debug = { hatalar: [], notlar: [], jsonUrller: [], yorumSekmesiOrnek: '' };
const hamYorumlar = [];
const sayilar = {};

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

/* Görünür metinden yorum avı: eski "Puan:" deseni + tarih çıpalı blok ayrıştırma */
function metinYorumAv(metin, topla) {
  let m;
  const rePuan = /([^\n]{30,1500}?)\s*\/\s*Puan:\s*(\d)/g;
  while ((m = rePuan.exec(metin)) !== null) {
    topla.push({ musteri: '', tarih: '', puan: Number(m[2]), yorum: m[1].replace(/\s+/g, ' ').trim() });
  }
  // Tarih çıpalı: "Ad Soyad" satırı + tarih satırı + metin blokları
  const satirlar = metin.split('\n').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < satirlar.length; i++) {
    const tarihMi = /^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(satirlar[i]) || /(gün|hafta|ay|yıl)\s+önce$/.test(satirlar[i]);
    if (!tarihMi) continue;
    // İsim: tarihten önceki kısa satır
    let isim = '';
    for (let g = i - 1; g >= Math.max(0, i - 3); g--) {
      if (satirlar[g].length >= 3 && satirlar[g].length <= 40 && !/\d/.test(satirlar[g])) { isim = satirlar[g]; break; }
    }
    // Metin: tarihten sonraki uzun satırlar
    let govde = [];
    for (let g = i + 1; g < Math.min(satirlar.length, i + 8); g++) {
      const s = satirlar[g];
      if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(s) || /(gün|hafta|ay|yıl)\s+önce$/.test(s)) break;
      if (s.length > 35) govde.push(s);
      else if (govde.length) break;
    }
    if (govde.length) {
      topla.push({ musteri: isim, tarih: satirlar[i], puan: null, yorum: govde.join(' ').replace(/\s+/g, ' ').slice(0, 1500) });
    }
  }
}

async function ana() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { debug.hatalar.push('playwright import: ' + e.message); return; }
  let browser;
  try { browser = await chromium.launch({ args: ['--no-sandbox'] }); }
  catch (e) { debug.hatalar.push('tarayıcı: ' + e.message); return; }

  const jsonHavuzu = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  });
  context.on('response', async (res) => {
    try {
      if (!(res.headers()['content-type'] || '').includes('json')) return;
      const veri = await res.json().catch(() => null);
      if (veri) { jsonHavuzu.push({ url: res.url(), veri }); debug.jsonUrller.push(res.url().slice(0, 160)); }
    } catch {}
  });

  async function tabTikla(page, desen) {
    const adaylar = await page.locator(`text=${desen}`).all().catch(() => []);
    for (const a of adaylar) {
      try {
        if (await a.isVisible({ timeout: 800 }).catch(() => false)) {
          await a.click({ timeout: 3000 });
          await page.waitForTimeout(3000);
          return true;
        }
      } catch {}
    }
    return false;
  }

  const page = await context.newPage();
  try {
    console.log('>>', OFIS_URL);
    await page.goto(OFIS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // ===== 1) MÜŞTERİ YORUMLARI SEKMESİ =====
    const tik = await tabTikla(page, 'Müşteri Yorumları');
    debug.notlar.push('yorum sekmesi tıklandı: ' + tik);

    let toplananMetin = '';
    for (let sayfaNo = 1; sayfaNo <= 40; sayfaNo++) {
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1600).catch(() => {}); await page.waitForTimeout(350); }
      // "daha fazla / tümünü gör" butonları
      try {
        const daha = page.getByRole('button', { name: /daha|devam|tümü|göster|more/i }).first();
        if (await daha.isVisible({ timeout: 400 }).catch(() => false)) { await daha.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(1500); }
      } catch {}
      const metin = await page.evaluate(() => document.body.innerText).catch(() => '');
      toplananMetin += '\n' + metin;
      if (sayfaNo === 1) debug.yorumSekmesiOrnek = metin.slice(metin.indexOf('Toplam Yorum') >= 0 ? metin.indexOf('Toplam Yorum') : 0, (metin.indexOf('Toplam Yorum') >= 0 ? metin.indexOf('Toplam Yorum') : 0) + 4500);
      // sonraki sayfa: ›, >, "Sonraki" veya sayfa numarası
      let ilerledi = false;
      for (const desen of [/^Sonraki$/i, /^›$/, /^>$/, new RegExp('^' + (sayfaNo + 1) + '$')]) {
        try {
          const b = page.locator('button, a').filter({ hasText: desen }).first();
          if (await b.isVisible({ timeout: 500 }).catch(() => false)) {
            await b.click({ timeout: 2000 }); await page.waitForTimeout(2200); ilerledi = true; break;
          }
        } catch {}
      }
      if (!ilerledi) { debug.notlar.push('yorum sayfalaması ' + sayfaNo + '. sayfada bitti'); break; }
    }
    const t1 = [];
    metinYorumAv(toplananMetin, t1);
    for (const j of jsonHavuzu) jsonYorumAv(j.veri, t1);
    for (const y of t1) hamYorumlar.push({ kaynakAd: null, ...y });
    console.log('Yorum sekmesinden ham yorum:', t1.length);
    debug.notlar.push('yorum sekmesi ham: ' + t1.length + ' | json cevap: ' + jsonHavuzu.length);

    // ===== 2) EKİBİMİZ SEKMESİ -> danışman linkleri =====
    await tabTikla(page, 'Ekibimiz');
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await page.waitForTimeout(300); }
    const linkler = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/danisman/"]')).map(a => a.href)
    ).catch(() => []);
    const ekip = [...new Set(linkler)].filter(u => /\/danisman\/\d+\//.test(u)).slice(0, 15);
    console.log('Ekip linki:', ekip.length);
    debug.notlar.push('ekip linki: ' + ekip.length);

    // ===== 3) PROFİLLER: yorum sayısı + varsa metinler =====
    for (const link of ekip) {
      try {
        const oncekiJson = jsonHavuzu.length;
        const p2 = await context.newPage();
        await p2.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p2.waitForTimeout(3500);
        await tabTikla(p2, 'Müşteri Yorumları').catch(() => {});
        for (let i = 0; i < 8; i++) { await p2.mouse.wheel(0, 1600).catch(() => {}); await p2.waitForTimeout(300); }
        const metin = await p2.evaluate(() => document.body.innerText).catch(() => '');
        await p2.close();

        const slug = (link.match(/\/danisman\/\d+\/([a-z0-9-]+)/) || [])[1] || '';
        const sahibi = DANISMANLAR.find(ad => slug.includes(norm(ad).replace(/[^a-z0-9]+/g, '-'))) ||
                       DANISMANLAR.find(ad => metin.includes(ad)) || null;
        const sy = metin.match(/([\d.,]+)\s*Müşteri Yorumu/);
        if (sahibi && sy) sayilar[sahibi] = Number(sy[1].replace(/[.,]/g, ''));
        const t = [];
        metinYorumAv(metin, t);
        for (const j of jsonHavuzu.slice(oncekiJson)) jsonYorumAv(j.veri, t);
        for (const y of t) hamYorumlar.push({ kaynakAd: sahibi, ...y });
        console.log('Profil:', sahibi || slug, '| sayı:', sy ? sy[1] : '-', '| ham:', t.length);
      } catch (e) { debug.hatalar.push('profil ' + link.slice(-30) + ': ' + e.message); }
    }
  } catch (e) {
    debug.hatalar.push('ana akış: ' + e.message);
  }
  try { await browser.close(); } catch {}
}

try { await ana(); } catch (e) { debug.hatalar.push('genel: ' + (e && e.message || e)); }

function kime(y) {
  if (y.kaynakAd) return y.kaynakAd;
  const m = ' ' + (y.yorum + ' ' + y.musteri).toLocaleLowerCase('tr') + ' ';
  let tam = null, kismi = null;
  for (const ad of DANISMANLAR) {
    const k = ad.toLocaleLowerCase('tr');
    if (m.includes(k)) { tam = ad; break; }
    const parca = k.split(' ');
    if (m.includes(' ' + parca[0] + ' ') || m.includes(' ' + parca[parca.length - 1] + ' ')) kismi = kismi || ad;
  }
  return tam || kismi || 'Ofis';
}

const gorulen = new Set();
const yorumlar = [];
for (const y of hamYorumlar) {
  const anahtar = (y.yorum || '').slice(0, 90);
  if (!anahtar || gorulen.has(anahtar) || y.yorum.length < 25) continue;
  gorulen.add(anahtar);
  yorumlar.push({
    ad: kime(y),
    musteri: y.musteri || '',
    tarih: y.tarih || '',
    yorum: y.yorum + (y.puan ? ` (Puan: ${y.puan}/5)` : '')
  });
}

debug.jsonUrller = [...new Set(debug.jsonUrller)].slice(0, 40);
const cikti = {
  guncelleme: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  ozet: DANISMANLAR.map(ad => ({ ad, yorumSayisi: sayilar[ad] ?? yorumlar.filter(y => y.ad === ad).length })),
  yorumlar,
  debug
};
fs.writeFileSync('yorumlar.json', JSON.stringify(cikti, null, 2));
console.log('BİTTİ — toplam yorum:', yorumlar.length, '| hata:', debug.hatalar.length);
