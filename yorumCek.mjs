/** RE/MAX DOĞUŞ — Yorum Toplayıcı v8 (sekme tıklama + sayfalama + zengin teşhis) */
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
    // Benzersiz kimlik: siteden gelen id/guid varsa en güvenilir tekilleştirme anahtarıdır.
    const idK = keys.find(k => /^(id|guid|uuid|commentid|reviewid|_id)$/i.test(k) && (typeof dugum[k] === 'string' || typeof dugum[k] === 'number'));
    topla.push({
      id: idK ? String(dugum[idK]) : '',
      musteri: String(dugum[isimK]).trim(),
      tarih: tarihK ? String(dugum[tarihK]).slice(0, 10) : '',
      puan: puanK ? Number(dugum[puanK]) : null,
      yorum: String(dugum[yorumK]).replace(/\s+/g, ' ').trim().slice(0, 1500)
    });
    return;
  }
  for (const k of keys) jsonYorumAv(dugum[k], topla, derinlik + 1);
}

/* Görünür metinden yorum avı — remax.com.tr dizilişi:
   [Baş harfler: "YE"] / [tarih: 16/07/2026] / [Müşteri adı] / [yorum metni...] / [kriter etiketi satırı] */
const KRITER = /Bölge Hakimliği|Sektör Bilgisi|Araçlar ve Teknoloji|Düzenli Bilgilendirme|Profesyonellik|Güvenirlik|İletişim Becerisi/;
function metinYorumAv(metin, topla) {
  let m;
  const rePuan = /([^\n]{30,1500}?)\s*\/\s*Puan:\s*(\d)/g;
  while ((m = rePuan.exec(metin)) !== null) {
    topla.push({ id: '', musteri: '', tarih: '', puan: Number(m[2]), yorum: m[1].replace(/\s+/g, ' ').trim() });
  }
  const satirlar = metin.split('\n').map(s => s.trim()).filter(Boolean);
  const tarihMi = s => /^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(s) || /(gün|hafta|ay|yıl)\s+önce$/.test(s);
  const basHarfMi = s => /^[A-ZÇĞİÖŞÜ]{1,3}$/.test(s);
  for (let i = 0; i < satirlar.length; i++) {
    if (!tarihMi(satirlar[i])) continue;
    // İsim: tarihten SONRAKİ kısa satır (kriter/baş harf değilse)
    let isim = '', basla = i + 1;
    if (basla < satirlar.length) {
      const aday = satirlar[basla];
      if (aday.length >= 3 && aday.length <= 45 && !KRITER.test(aday) && !basHarfMi(aday) && !tarihMi(aday) && !/\d{3,}/.test(aday)) {
        isim = aday; basla++;
      }
    }
    // Gövde: kriter satırına, baş harfe veya yeni tarihe kadar
    let govde = [];
    for (let g = basla; g < Math.min(satirlar.length, basla + 10); g++) {
      const s = satirlar[g];
      if (tarihMi(s) || basHarfMi(s) || KRITER.test(s)) break;
      if (s.length > 25) govde.push(s);
    }
    if (govde.length) {
      let yorum = govde.join(' ').replace(/\s+/g, ' ').trim();
      yorum = yorum.replace(new RegExp('(' + KRITER.source + ')[,\\s]*', 'g'), '').trim();
      if (yorum.length > 25) topla.push({ id: '', musteri: isim, tarih: satirlar[i], puan: null, yorum: yorum.slice(0, 1500) });
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
  let commentIstek = null; // sitenin yorum API çağrısını yakala
  page.on('request', req => {
    try {
      if (req.url().includes('/api/Employee/Comment') && !commentIstek) {
        commentIstek = { url: req.url(), method: req.method(), postData: req.postData() || '' };
        debug.notlar.push('Comment API yakalandı: ' + req.method() + ' ' + req.url().slice(0, 120));
      }
    } catch {}
  });
  try {
    console.log('>>', OFIS_URL);
    await page.goto(OFIS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // ===== 1) MÜŞTERİ YORUMLARI SEKMESİ =====
    const tik = await tabTikla(page, 'Müşteri Yorumları');
    debug.notlar.push('yorum sekmesi tıklandı: ' + tik);

    // Önce "daha fazla göster" tarzı butonu doyana kadar tıkla
    let oncekiUzunluk = 0;
    for (let d = 0; d < 60; d++) {
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2000).catch(() => {}); await page.waitForTimeout(250); }
      let tiklandi = false;
      for (const desen of [/daha fazla/i, /devamını/i, /tümünü/i, /göster/i, /load more/i]) {
        try {
          const b = page.locator('button, a, div[role="button"]').filter({ hasText: desen }).first();
          if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
            await b.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(1600);
            tiklandi = true; break;
          }
        } catch {}
      }
      const su = (await page.evaluate(() => document.body.innerText.length).catch(() => 0));
      if (!tiklandi && su === oncekiUzunluk) break;
      if (su === oncekiUzunluk && d > 5) break;
      oncekiUzunluk = su;
    }
    debug.notlar.push('daha-fazla sonrası metin uzunluğu: ' + oncekiUzunluk);

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

    // ===== API TEKRARI: yakalanan Comment isteğini sayfa sayfa çağır =====
    if (commentIstek) {
      try {
        let govde = null;
        try { govde = commentIstek.postData ? JSON.parse(commentIstek.postData) : null; } catch {}
        debug.notlar.push('Comment isteği gövdesi: ' + (commentIstek.postData || '(boş)').slice(0, 200));
        const sayfaAnahtari = govde ? Object.keys(govde).find(k => /page|index|skip/i.test(k)) : null;
        let oncekiToplam = -1;
        for (let s = 0; s < 40; s++) {
          let cevap;
          if (commentIstek.method === 'POST') {
            const g2 = govde ? { ...govde } : {};
            if (sayfaAnahtari) g2[sayfaAnahtari] = /skip/i.test(sayfaAnahtari) ? s * 20 : (/index/i.test(sayfaAnahtari) ? s : s + 1);
            cevap = await context.request.post(commentIstek.url, { data: g2, headers: { 'content-type': 'application/json' } }).catch(() => null);
          } else {
            const u = new URL(commentIstek.url);
            const pk = [...u.searchParams.keys()].find(k => /page|index|skip/i.test(k));
            if (pk) u.searchParams.set(pk, String(/skip/i.test(pk) ? s * 20 : s + 1));
            else u.searchParams.set('page', String(s + 1));
            cevap = await context.request.get(u.toString()).catch(() => null);
          }
          if (!cevap || !cevap.ok()) { debug.notlar.push('API sayfa ' + s + ': cevap yok/başarısız'); break; }
          const veri = await cevap.json().catch(() => null);
          if (!veri) break;
          const once = t1.length;
          jsonYorumAv(veri, t1);
          if (s === 0) debug.notlar.push('API ilk sayfa yeni kayıt: ' + (t1.length - once));
          if (t1.length === once) break;              // yeni kayıt gelmedi -> bitti
          if (t1.length === oncekiToplam) break;
          oncekiToplam = t1.length;
          if (!sayfaAnahtari && commentIstek.method === 'POST') break; // sayfalanamıyor
        }
        debug.notlar.push('API tekrarı sonrası ham: ' + t1.length);
      } catch (e) { debug.hatalar.push('API tekrarı: ' + e.message); }
    } else {
      debug.notlar.push('Comment API isteği yakalanamadı');
    }

    // NOT: Ofis sekmesinden toplanan yorumlar (t1) artık hamYorumlar'a EKLENMİYOR.
    // Puanlama danışman bazlı; her yorum yalnızca kendi danışmanının profilinden bir kez toplanır.
    // Bu döngünün tek amacı Comment API şablonunu (commentIstek) yakalamaktı; o yakalandı.
    debug.notlar.push('yorum sekmesi ham (yalnızca teşhis, eklenmedi): ' + t1.length + ' | json cevap: ' + jsonHavuzu.length);

    // ===== 2) EKİBİMİZ SEKMESİ -> danışman linkleri =====
    await tabTikla(page, 'Ekibimiz');
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 1500).catch(() => {}); await page.waitForTimeout(300); }
    const linkler = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/danisman/"], a[href*="/agent/"]')).map(a => a.href)
    ).catch(() => []);
    // ID formatı "35392" veya "35392-801" olabilir. Aynı danışmanı iki kez işlememek için
    // numerik ID'nin ilk parçasına (35392) göre tekilleştir.
    const ekipHam = [...new Set(linkler)].filter(u => /\/(danisman|agent)\/[\d-]+\//.test(u));
    const ekipMap = new Map();
    for (const u of ekipHam) {
      const idm = u.match(/\/(?:danisman|agent)\/(\d+)/);
      const id = idm ? idm[1] : u;
      if (!ekipMap.has(id)) ekipMap.set(id, u); // ilk görüleni tut
    }
    const ekip = [...ekipMap.values()].slice(0, 20);
    console.log('Ekip linki:', ekip.length, '(ham:', ekipHam.length + ')');
    debug.notlar.push('ekip linki: ' + ekip.length + ' (ham: ' + ekipHam.length + ', tekil ID: ' + ekipMap.size + ')');

    // ===== 3) PROFİLLER: her danışmanın kendi sayfasından, izole şekilde =====
    for (const link of ekip) {
      try {
        const p2 = await context.newPage();
        // ÇAPRAZ BULAŞMA ÖNLEME: JSON cevaplarını SADECE bu sayfaya bağlı dinle,
        // ortak havuza değil. Böylece bir profilin geç gelen cevabı diğerine yazılmaz.
        const p2Json = [];
        p2.on('response', async (res) => {
          try {
            if (!(res.headers()['content-type'] || '').includes('json')) return;
            const veri = await res.json().catch(() => null);
            if (veri) p2Json.push({ url: res.url(), veri });
          } catch {}
        });

        await p2.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p2.waitForTimeout(3000);
        await tabTikla(p2, 'Müşteri Yorumları').catch(() => {});
        // "daha fazla göster" doyana kadar tıkla — danışmanın TÜM yorumları gelsin
        let pOnceki = 0;
        for (let d = 0; d < 50; d++) {
          for (let i = 0; i < 4; i++) { await p2.mouse.wheel(0, 1800).catch(() => {}); await p2.waitForTimeout(250); }
          let tik = false;
          for (const desen of [/daha fazla/i, /devamını/i, /tümünü/i, /göster/i, /load more/i]) {
            try {
              const b = p2.locator('button, a, div[role="button"]').filter({ hasText: desen }).first();
              if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
                await b.click({ timeout: 2000 }).catch(() => {});
                await p2.waitForTimeout(1400);
                tik = true; break;
              }
            } catch {}
          }
          const su = await p2.evaluate(() => document.body.innerText.length).catch(() => 0);
          if (!tik && su === pOnceki) break;
          if (su === pOnceki && d > 4) break;
          pOnceki = su;
        }
        // Tüm yorum API cevaplarının inmesini garanti et (son sayfa kaçmasın).
        await p2.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await p2.waitForTimeout(1200);
        const sayfa = await p2.evaluate(() => ({
          metin: document.body.innerText,
          baslik: document.title || '',
          h1: (document.querySelector('h1,h2')?.innerText || '')
        })).catch(() => ({ metin: '', baslik: '', h1: '' }));
        await p2.close();
        const metin = sayfa.metin || '';

        // ===== SAHİBİ BELİRLEME (KESİN): sayfa başlığı danışmanın tam adıyla başlar =====
        // Örn: "İrem Aleyna Tetik - RE/MAX Doğuş - Gayrimenkul Danışmanı ..."
        const basAd = (sayfa.baslik.split(/[-|]/)[0] || '').trim();
        const h1Ad = (sayfa.h1.split(/[-|]/)[0] || '').trim();
        const slug = (link.match(/\/(?:danisman|agent)\/[\d-]+\/([a-z0-9-]+)/) || [])[1] || '';
        const slugNorm = norm(slug).replace(/[^a-z0-9]+/g, '-');

        // Her aday kaynağı için roster ile eşleştir; skorla (ad parçası sayısı).
        const skorla = (kaynakMetin) => {
          const km = norm(kaynakMetin || '');
          let en = null, enSkor = 0;
          for (const ad of DANISMANLAR) {
            const parcalar = norm(ad).split(' ').filter(Boolean);
            const varOlan = parcalar.filter(p => km.includes(p)).length;
            // İlk + son ad şart (orta ad düşebilir): en az 2 parça veya tek parçalıysa 1
            const yeter = parcalar.length >= 2 ? varOlan >= 2 : varOlan >= 1;
            if (yeter && varOlan > enSkor) { enSkor = varOlan; en = ad; }
          }
          return en;
        };
        // Öncelik: başlık > h1 > slug (tümü tireli/boşluklu farkına dayanıklı)
        let sahibi = skorla(basAd) || skorla(h1Ad) || skorla(slugNorm.replace(/-/g, ' '));
        debug.notlar.push(`profil çöz: id=${(link.match(/\/(?:danisman|agent)\/(\d+)/)||[])[1]||'?'} slug="${slug}" baslik="${basAd}" -> ${sahibi || 'EŞLEŞMEDİ'}`);
        if (!sahibi) { debug.notlar.push('profil eşleşmedi (eski danışman olabilir): ' + slug + ' | baslik: ' + basAd); continue; }

        // Rozet sayısı: farklı düzenlerde gelebilir; birden çok deseni dene.
        const syDesenler = [
          /([\d.,]+)\s*Müşteri Yorumu/i,
          /Müşteri Yorum(?:u|ları)\s*\(?\s*([\d.,]+)\s*\)?/i,
          /Yorumlar\s*\(?\s*([\d.,]+)\s*\)?/i,
          /([\d.,]+)\s*yorum/i
        ];
        let siteSay = null;
        for (const re of syDesenler) {
          const mm = metin.match(re);
          if (mm) { siteSay = Number(mm[1].replace(/[.,]/g, '')); break; }
        }
        if (siteSay != null) sayilar[sahibi] = siteSay;

        // KAYNAK ÖNCELİĞİ: bu profilin izole JSON'undan yorumları al (yapısal, güvenilir).
        // JSON hiç yorum vermezse görünür metne düş (yedek).
        const jsonAdaylar = [];
        for (const j of p2Json) jsonYorumAv(j.veri, jsonAdaylar);
        let profilYorumlari = jsonAdaylar;
        let kaynak = 'json';
        if (profilYorumlari.length === 0) {
          const metinAdaylar = [];
          metinYorumAv(metin, metinAdaylar);
          profilYorumlari = metinAdaylar;
          kaynak = 'metin';
        }

        // PROFİL İÇİ TEKİLLEŞTİRME: aynı yorum API sayfalamasında iki kez gelebilir.
        const profilGorulen = new Set();
        const benzersiz = [];
        for (const y of profilYorumlari) {
          if (!y.yorum || y.yorum.length < 25) continue;
          // İmza: tam yorum metni + müşteri + tarih. Kesme yok -> iki farklı yorum yanlışlıkla birleşmez.
          const imza = y.id
            ? 'id:' + y.id
            : (norm(y.musteri || '') + '|' + norm(y.tarih || '') + '|' + norm(y.yorum)).replace(/[^a-z0-9|]+/g, '');
          if (imza.length < 6 || profilGorulen.has(imza)) continue;
          profilGorulen.add(imza);
          benzersiz.push(y);
        }
        for (const y of benzersiz) hamYorumlar.push({ kaynakAd: sahibi, ...y });

        // Sayı denetimi: toplanan ile remax rozeti tutuyor mu?
        if (siteSay != null && benzersiz.length !== siteSay) {
          debug.notlar.push(`SAYI FARKI ${sahibi}: remax=${siteSay}, toplanan=${benzersiz.length} (kaynak:${kaynak}, jsonCevap:${p2Json.length})`);
        }
        console.log('Profil:', sahibi, '| site:', siteSay ?? '-', '| toplanan:', benzersiz.length, '| kaynak:', kaynak);
      } catch (e) { debug.hatalar.push('profil ' + link.slice(-30) + ': ' + e.message); }
    }
  } catch (e) {
    debug.hatalar.push('ana akış: ' + e.message);
  }
  try { await browser.close(); } catch {}
}

try { await ana(); } catch (e) { debug.hatalar.push('genel: ' + (e && e.message || e)); }

/* EŞLEŞTİRME KURALI (broker kararı):
   Yorum hangi danışmanın remax.com.tr profil sayfasında yayınlanıyorsa O DANIŞMANA aittir.
   Metin içinde geçen isimlere BAKILMAZ (bir yorumda birden fazla kişi anılabilir, yanıltır).
   Profil dışından (ofis sayfası) gelen yorumlar "Ofis" olarak kaydedilir. */
function kime(y) {
  return y.kaynakAd || 'Ofis';
}

const gorulen = new Set();
const yorumlar = [];
hamYorumlar.sort((a, b) => (b.kaynakAd ? 1 : 0) - (a.kaynakAd ? 1 : 0)); // profil kaynaklılar önce
// Anahtar danışman bazlı: iki farklı danışmanda aynı müşteri adı/metni yanlışlıkla elenmesin.
const anahtarla = y => {
  const kim = (y.kaynakAd || 'Ofis');
  const cekirdek = y.id
    ? 'id:' + y.id
    : ((y.musteri || '') + '|' + (y.tarih || '') + '|' + (y.yorum || '')).toLocaleLowerCase('tr').replace(/[^a-zçğıöşü0-9]+/g, '');
  return kim + '::' + cekirdek;
};
for (const y of hamYorumlar) {
  const anahtar = anahtarla(y);
  const kimlikGecerli = y.id ? true : anahtar.length >= 24; // id yoksa yeterli imza uzunluğu iste
  if (!kimlikGecerli || gorulen.has(anahtar) || !y.yorum || y.yorum.length < 25) continue;
  gorulen.add(anahtar);
  yorumlar.push({
    ad: kime(y),
    musteri: y.musteri || '',
    tarih: y.tarih || '',
    yorum: y.yorum + (y.puan ? ` (Puan: ${y.puan}/5)` : '')
  });
}

debug.jsonUrller = [...new Set(debug.jsonUrller)].slice(0, 40);
// Sayı denetimi özeti: toplanan ile remax rozeti tutuyor mu?
const denetim = DANISMANLAR.map(ad => {
  const toplanan = yorumlar.filter(y => y.ad === ad).length;
  const site = sayilar[ad] ?? null;
  return { ad, toplanan, site, tutuyor: site == null ? null : toplanan === site };
});
const uyumsuz = denetim.filter(d => d.tutuyor === false);
const cikti = {
  guncelleme: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  ozet: DANISMANLAR.map(ad => ({ ad, yorumSayisi: yorumlar.filter(y => y.ad === ad).length, siteSayisi: sayilar[ad] ?? null })),
  sayiDenetimi: { tumUyumlu: uyumsuz.length === 0, uyumsuz, detay: denetim },
  yorumlar,
  debug
};
fs.writeFileSync('yorumlar.json', JSON.stringify(cikti, null, 2));
console.log('BİTTİ — toplam yorum:', yorumlar.length, '| hata:', debug.hatalar.length);
if (uyumsuz.length) {
  console.log('⚠ SAYI FARKI olan danışmanlar:');
  for (const d of uyumsuz) console.log(`   ${d.ad}: remax=${d.site}, toplanan=${d.toplanan}`);
} else {
  console.log('✓ Tüm danışmanlarda toplanan sayı remax ile bire bir tutuyor.');
}
