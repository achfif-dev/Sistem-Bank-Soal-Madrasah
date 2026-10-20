// Uji pengambil kitab ke situs sungguhan. Dijalankan lewat GitHub Actions (lihat .github/workflows/uji-situs-kitab.yml).
// Keluaran berupa tabel Markdown (masuk ke Job Summary). Hanya mencetak ringkasan dan 80 karakter pertama,
// bukan seluruh teks kitab.
import { parseKitabUrl, fetchKitab, DEFAULT_HOSTS, arabicRatio } from '../src/kitabFetch.js';

const urls = String(process.env.URLS || process.argv[2] || '').split(/[\s,]+/).filter(Boolean);
if (!urls.length) { console.log('Tidak ada URL. Isi input "urls".'); process.exit(1); }

const UA = 'BankSoalMadrasah/1.0 (alat bantu guru; satu halaman per permintaan)';
const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ');
const rows = [];
let gagal = 0;

for (const raw of urls) {
  const row = { url: raw };
  try {
    const u = parseKitabUrl(raw, DEFAULT_HOSTS);
    // Diagnosis mentah: apa yang sebenarnya dikirim situs ke server?
    const res = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9', 'Accept-Language': 'ar,id;q=0.8' } });
    const html = await res.text();
    row.http = res.status;
    row.tipe = (res.headers.get('content-type') || '').split(';')[0];
    row.nass = /class\s*=\s*["'][^"']*\bnass\b/.test(html) ? 'ada' : 'TIDAK';
    row.hamesh = /class\s*=\s*["'][^"']*\bhamesh\b/.test(html) ? 'ada' : 'tidak';
    row.cf = /cf-ray|cloudflare/i.test([...res.headers.keys()].join(' ') + (res.headers.get('server') || '')) ? 'ya' : 'tidak';
    row.penandaP = (html.match(/#p\d+/g) || []).length;
    // Jalur nyata aplikasi
    try {
      const k = await fetchKitab(raw);
      row.hasil = 'OK';
      row.kitab = `${k.nama || '-'} (hal ${k.hal || '-'}, idx ${k.idx || '-'}, ${k.kitabId || '-'})`;
      row.panjang = k.teks.length;
      row.rasioArab = arabicRatio(k.teks).toFixed(2);
      row.sisaPenanda = (k.teks.match(/#p\d+/g) || []).length;
      row.awal = k.teks.slice(0, 80).replace(/\n/g, ' ');
    } catch (e) {
      gagal++;
      row.hasil = `GAGAL ${e.code || e.name}`;
      row.kitab = e.message;
    }
  } catch (e) {
    gagal++;
    row.hasil = `GAGAL ${e.code || e.name}`;
    row.kitab = e.message;
  }
  rows.push(row);
}

console.log('## Uji pengambil kitab\n');
console.log('| URL | HTTP | Tipe | nass | hamesh | Cloudflare | #p mentah | Hasil | Kitab | Panjang | Rasio Arab | #p tersisa |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${cell(r.url)} | ${cell(r.http)} | ${cell(r.tipe)} | ${cell(r.nass)} | ${cell(r.hamesh)} | ${cell(r.cf)} | ${cell(r.penandaP)} | ${cell(r.hasil)} | ${cell(r.kitab)} | ${cell(r.panjang)} | ${cell(r.rasioArab)} | ${cell(r.sisaPenanda)} |`);
}
console.log('\n### Awal teks (80 karakter)\n');
for (const r of rows) if (r.awal) console.log(`- ${cell(r.url)}: ${r.awal}`);
process.exit(gagal ? 2 : 0);
