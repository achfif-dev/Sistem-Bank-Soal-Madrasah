import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKitabUrl, htmlToArabicText, parseTitle, parseBookUrl, fetchKitab, findByClass, DEFAULT_HOSTS } from '../src/kitabFetch.js';

const ISI = 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ وَالصَّلَاةُ وَالسَّلَامُ عَلَى أَشْرَفِ الْمُرْسَلِينَ';
const PAGE = `<!doctype html><html><head><title>ص3 - الفواكه العذاب - تقريظ - المكتبة الشاملة.</title><script>var x="مرحبا بكم في الموقع الإلكتروني للمكتبة";</script></head>
<body><nav><a>الرئيسية</a> <a>كتب مختارة من المكتبة الشاملة</a></nav>
<div class="nass margin-top-10"><div class="inner"><p>${ISI}</p></div><p>&#1605;&#1585;&#1581;&#1576;&#1575; &#1576;&#1603;&#1605;</p><p>[1]</p></div>
<div class="hamesh"><p>حاشية من المحقق لا تدخل في النص الأصلي للكتاب أبدا</p></div>
<footer>جميع الحقوق محفوظة للمكتبة الشاملة الإلكترونية</footer></body></html>`;

const resp = (body, { status = 200, type = 'text/html; charset=utf-8', location } = {}) => ({
  status, headers: { get: (k) => ({ 'content-type': type, location }[k.toLowerCase()] ?? null) }, text: async () => body,
});

test('parseKitabUrl: izinkan domain terdaftar, tolak yang lain', () => {
  assert.equal(parseKitabUrl('https://shamela.ws/book/1/3#x', DEFAULT_HOSTS).href, 'https://shamela.ws/book/1/3');
  assert.equal(parseKitabUrl('https://www.shamela.ws/book/1/3', DEFAULT_HOSTS).hostname, 'www.shamela.ws');
  for (const bad of ['http://shamela.ws/x', 'https://evil.com/shamela.ws', 'https://shamela.ws.evil.com/x', 'https://user:pw@shamela.ws/x', 'https://shamela.ws:8443/x', 'https://127.0.0.1/x', 'bukan url', 'file:///etc/passwd']) {
    assert.throws(() => parseKitabUrl(bad, DEFAULT_HOSTS), (e) => ['URL_INVALID', 'URL_NOT_ALLOWED'].includes(e.code), bad);
  }
});

test('htmlToArabicText: ambil isi .nass, buang menu, skrip, catatan kaki, footer', () => {
  const { title, teks } = htmlToArabicText(PAGE);
  assert.match(title, /^ص3/);
  assert.ok(teks.includes(ISI));
  assert.ok(teks.includes('مرحبا بكم')); // entitas numerik terdekode
  assert.ok(!teks.includes('الرئيسية'));
  assert.ok(!teks.includes('حاشية من المحقق'));
  assert.ok(!teks.includes('جميع الحقوق'));
  assert.ok(!teks.includes('[1]')); // bukan Arab
  assert.equal(findByClass('<div class="nass"><div>a</div><div>b</div></div><div>c</div>', 'nass')[0].inner, '<div>a</div><div>b</div>');
});

test('htmlToArabicText: tanpa .nass memakai cadangan (baris Arab panjang saja)', () => {
  const { teks } = htmlToArabicText(`<body><p>قائمة</p><p>${ISI}</p><p>English paragraph that is long enough to pass length</p></body>`);
  assert.equal(teks, ISI);
});

test('parseTitle', () => {
  assert.deepEqual(parseTitle('ص3 - الفواكه العذاب - تقريظ - المكتبة الشاملة.'), { hal: '3', nama: 'الفواكه العذاب' });
  assert.deepEqual(parseTitle('Judul biasa'), { hal: '', nama: '' });
});

test('fetchKitab: sukses, redirect ke domain luar ditolak, error situs', async () => {
  const ok = await fetchKitab('https://shamela.ws/book/1/3', { fetchImpl: async () => resp(PAGE) });
  assert.equal(ok.hal, '3'); assert.equal(ok.nama, 'الفواكه العذاب'); assert.equal(ok.terpotong, false); assert.ok(ok.teks.includes(ISI));

  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp('', { status: 302, location: 'https://evil.com/steal' }) }), { code: 'URL_NOT_ALLOWED' });
  const hops = []; 
  const r = await fetchKitab('https://shamela.ws/a', { fetchImpl: async (u) => { hops.push(u); return hops.length === 1 ? resp('', { status: 301, location: '/book/1/3' }) : resp(PAGE); } });
  assert.equal(r.url, 'https://shamela.ws/book/1/3');

  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp('x', { status: 404 }) }), { code: 'SUMBER_NOT_FOUND' });
  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp('x', { status: 403 }), retryDelayMs: 0 }), { code: 'SUMBER_BLOCKED' });
  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp('%PDF', { type: 'application/pdf' }) }), { code: 'SUMBER_BUKAN_TEKS' });
  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp('<html><body><p>English only</p></body></html>') }), { code: 'TEKS_TIDAK_DITEMUKAN' });
  await assert.rejects(fetchKitab('https://shamela.ws/x', { maxBytes: 100, fetchImpl: async () => resp(PAGE) }), { code: 'SUMBER_TOO_LARGE' });
  await assert.rejects(fetchKitab('https://shamela.ws/x', { fetchImpl: async () => { throw new Error('ECONNRESET'); } }), { code: 'SUMBER_ERROR' });
});

test('fetchKitab: teks panjang dipotong di batas baris dan ditandai', async () => {
  const long = Array.from({ length: 400 }, () => `<p>${ISI}</p>`).join('');
  const r = await fetchKitab('https://shamela.ws/x', { fetchImpl: async () => resp(`<div class="nass">${long}</div>`) });
  assert.equal(r.terpotong, true);
  assert.ok(r.teks.length <= 6000);
  assert.ok(r.teks.endsWith('الْمُرْسَلِينَ'));
});

test('fetchKitab: timeout menjadi 504', async () => {
  const slow = (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
  await assert.rejects(fetchKitab('https://shamela.ws/x', { timeoutMs: 20, fetchImpl: slow }), { code: 'SUMBER_TIMEOUT', status: 504 });
});

test('htmlToArabicText: penanda paragraf #pN dari shamela dibuang', () => {
  const html = `<html><head><title>ص21 - كتاب - الدليل - المكتبة الشاملة</title></head><body><div class="nass"><p>${ISI}<a href="#p5">#p5</a></p><p>${ISI} <a href="#p6">#p6</a></p></div></body></html>`;
  const { teks } = htmlToArabicText(html);
  assert.ok(!/#p\d/.test(teks));
  assert.equal(teks.split('\n').length, 2);
});

test('parseBookUrl: ambil kitabId dan idx dari URL, abaikan situs/pola lain', () => {
  assert.deepEqual(parseBookUrl('https://shamela.ws/book/12085/17#p1'), { kitabId: 'shamela_12085', bookId: '12085', idx: '17' });
  assert.deepEqual(parseBookUrl('https://www.al-maktaba.org/book/33/5'), { kitabId: 'maktaba_33', bookId: '33', idx: '5' });
  assert.deepEqual(parseBookUrl('https://shamela.ws/book/12085'), {});
  assert.deepEqual(parseBookUrl('https://archive.org/details/x'), {});
});

test('fetchKitab: hasil memuat kitabId dan idx untuk URL shamela', async () => {
  const r = await fetchKitab('https://shamela.ws/book/12085/17', { fetchImpl: async () => resp(PAGE) });
  assert.equal(r.kitabId, 'shamela_12085');
  assert.equal(r.idx, '17');
});

test('fetchKitab: 403 sesaat (tantangan Cloudflare) dicoba ulang sekali, 429 tidak', async () => {
  let n = 0;
  const r = await fetchKitab('https://shamela.ws/book/12085/17', { retryDelayMs: 0, fetchImpl: async () => (++n === 1 ? resp('', { status: 403 }) : resp(PAGE)) });
  assert.equal(n, 2);
  assert.equal(r.idx, '17');
  let m = 0;
  await assert.rejects(fetchKitab('https://shamela.ws/x', { retryDelayMs: 0, fetchImpl: async () => { m++; return resp('', { status: 429 }); } }), { code: 'SUMBER_BLOCKED' });
  assert.equal(m, 1);
  let k = 0;
  await assert.rejects(fetchKitab('https://shamela.ws/x', { retryDelayMs: 0, fetchImpl: async () => { k++; return resp('', { status: 403 }); } }), { code: 'SUMBER_BLOCKED' });
  assert.equal(k, 2); // hanya satu kali ulang
});
