// Uji pengambil kitab ke situs sungguhan lewat GitHub Actions (.github/workflows/uji-situs-kitab.yml).
// Diagnosis diambil dari respons YANG SAMA dengan yang dipakai fetchKitab (bukan permintaan terpisah),
// dan tiap URL diulang beberapa kali karena Cloudflare bisa menjawab berbeda untuk permintaan identik.
// Hanya struktur tag dan ringkasan yang dicetak, bukan isi kitab.
import { parseKitabUrl, fetchKitab, findByClass, DEFAULT_HOSTS, arabicRatio } from '../src/kitabFetch.js';

const urls = String(process.env.URLS || process.argv[2] || '').split(/[\s,]+/).filter(Boolean);
const ulang = Math.min(Math.max(parseInt(process.env.ULANG || '3', 10) || 3, 1), 10);
if (!urls.length) { console.log('Tidak ada URL. Isi input "urls".'); process.exit(1); }

const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const skeleton = (inner) => [...inner.matchAll(/<([a-z0-9]+)((?:\s[^>]*?)?)>/gi)].slice(0, 30)
  .map((m) => { const c = /class\s*=\s*["']([^"']*)["']/i.exec(m[2]); return c ? `${m[1]}.${c[1].trim().split(/\s+/).join('.')}` : m[1]; }).join(' ');

const rows = [];
const skel = new Map();
let gagal = 0;

for (const raw of urls) {
  try { parseKitabUrl(raw, DEFAULT_HOSTS); } catch (e) { gagal++; rows.push({ url: raw, n: '-', hasil: `GAGAL ${e.code}`, kitab: e.message }); continue; }
  for (let n = 1; n <= ulang; n++) {
    const row = { url: raw, n };
    const cap = {};
    const spy = async (href, opt) => {
      const res = await fetch(href, opt);
      cap.status = res.status;
      cap.tipe = (res.headers.get('content-type') || '').split(';')[0];
      cap.cf = res.headers.has('cf-ray') || /cloudflare/i.test(res.headers.get('server') || '');
      cap.mitigasi = res.headers.get('cf-mitigated') || '';
      if (res.status === 200) cap.html = await res.clone().text();
      return res;
    };
    try {
      const k = await fetchKitab(raw, { fetchImpl: spy });
      const nass = findByClass(cap.html || '', 'nass');
      row.http = cap.status; row.cf = cap.cf ? 'ya' : 'tidak';
      row.nass = nass.length ? `ada (${nass.length})` : 'TIDAK (jalur cadangan)';
      row.pMentah = ((cap.html || '').match(/#p\d+/g) || []).length;
      row.hasil = 'OK';
      row.kitab = `${k.nama || '-'} | hal ${k.hal || '-'} | idx ${k.idx || '-'} | ${k.kitabId || '-'}`;
      row.panjang = k.teks.length;
      row.baris = k.teks.split('\n').length;
      row.rasio = arabicRatio(k.teks).toFixed(2);
      row.pSisa = (k.teks.match(/#p\d+/g) || []).length;
      row.awal = k.teks.slice(0, 80).replace(/\n/g, ' ');
      if (nass.length && !skel.has(raw)) skel.set(raw, skeleton(nass[0].inner));
    } catch (e) {
      gagal++;
      row.http = cap.status ?? '-'; row.cf = cap.cf ? 'ya' : (cap.cf === false ? 'tidak' : '-');
      row.hasil = `GAGAL ${e.code || e.name}`; row.kitab = (cap.mitigasi ? `cf-mitigated=${cap.mitigasi}. ` : '') + e.message;
    }
    rows.push(row);
    if (n < ulang) await tidur(2000);
  }
}

console.log('## Uji pengambil kitab\n');
console.log('| URL | # | HTTP | CF | nass | #p mentah | Hasil | Kitab | Panjang | Baris | Rasio Arab | #p sisa |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${cell(r.url)} | ${cell(r.n)} | ${cell(r.http)} | ${cell(r.cf)} | ${cell(r.nass)} | ${cell(r.pMentah)} | ${cell(r.hasil)} | ${cell(r.kitab)} | ${cell(r.panjang)} | ${cell(r.baris)} | ${cell(r.rasio)} | ${cell(r.pSisa)} |`);
const ok = rows.filter((r) => r.hasil === 'OK').length;
console.log(`\n**Berhasil ${ok} dari ${rows.length} percobaan.**`);
console.log('\n### Awal teks (80 karakter)\n');
for (const r of rows) if (r.awal) { console.log(`- ${cell(r.url)} (#${r.n}): ${r.awal}`); }
console.log('\n### Kerangka tag blok .nass (tanpa isi)\n');
for (const [u, s] of skel) console.log(`- ${cell(u)}: \`${s}\``);
process.exit(gagal ? 2 : 0);
