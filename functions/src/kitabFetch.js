// Mengambil satu halaman teks kitab dari situs perpustakaan online yang diizinkan.
// Dipicu pengguna (satu tautan per permintaan), bukan perayap. Teks dikembalikan untuk diperiksa
// dan disunting pengguna sebelum dipakai, beserta tautan sumber.
import { ApiError, MAX_TEKS } from './soalService.js';

export const DEFAULT_HOSTS = ['shamela.ws', 'al-maktaba.org', 'islamweb.net', 'ar.wikisource.org', 'archive.org', 'ketabonline.com'];

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LETTER = /\p{L}/u;

export const arabicRatio = (str) => {
  let l = 0; let a = 0;
  for (const ch of str) if (LETTER.test(ch)) { l++; if (ARABIC.test(ch)) a++; }
  return l ? a / l : 0;
};

export const hostAllowed = (host, allowed) => allowed.some((h) => host === h || host.endsWith('.' + h));

/** Validasi tautan: https, tanpa kredensial, port standar, domain di daftar izin. */
export function parseKitabUrl(raw, allowed) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new ApiError(422, 'URL_INVALID', 'Tautan tidak valid. Tempel alamat lengkap yang diawali https://'); }
  if (u.protocol !== 'https:') throw new ApiError(422, 'URL_INVALID', 'Hanya tautan https:// yang diterima.');
  if (u.username || u.password || (u.port && u.port !== '443')) throw new ApiError(422, 'URL_INVALID', 'Tautan tidak valid.');
  if (!hostAllowed(u.hostname.toLowerCase(), allowed)) {
    throw new ApiError(422, 'URL_NOT_ALLOWED', `Situs ini belum didukung. Situs yang didukung: ${allowed.join(', ')}.`);
  }
  u.hash = '';
  return u;
}

/* -------------------------------------------------------------- HTML ke teks */
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (t) => t
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
  .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, n) => NAMED[n]);

const classTokens = (attrs) => {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return m ? (m[1] ?? m[2]).split(/\s+/) : [];
};

/** Elemen (dengan penghitungan tag bersarang) yang memiliki kelas tertentu. */
export function findByClass(html, token) {
  const found = [];
  const open = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m;
  while ((m = open.exec(html))) {
    if (m[2].endsWith('/') || !classTokens(m[2]).includes(token)) continue;
    const tag = m[1].toLowerCase();
    const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
    re.lastIndex = open.lastIndex;
    let depth = 1; let t; let end = html.length;
    while ((t = re.exec(html))) {
      if (t[2]) continue; // self-closing
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    found.push({ start: m.index, end: Math.min(html.length, end + tag.length + 3), inner: html.slice(open.lastIndex, end) });
    open.lastIndex = Math.max(open.lastIndex, end);
  }
  return found;
}

const removeByClass = (html, token) => {
  let out = html;
  for (const f of findByClass(html, token).reverse()) out = out.slice(0, f.start) + out.slice(f.end);
  return out;
};

const blocksToText = (html) => decode(
  html
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ''),
).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);

export function htmlToArabicText(html, { plain = false } = {}) {
  if (plain) {
    const lines = html.split(/\r?\n/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l) => l && arabicRatio(l) >= 0.5);
    return { title: '', teks: lines.join('\n') };
  }
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = tm ? decode(tm[1]).replace(/\s+/g, ' ').trim() : '';

  let body = html.replace(/<!--[\s\S]*?-->/g, '');
  body = body.replace(/<(script|style|noscript|svg|template|iframe|select|button|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, '');
  body = removeByClass(body, 'hamesh'); // catatan kaki penerbit/muhaqqiq

  const nass = findByClass(body, 'nass'); // isi kitab pada shamela.ws dan al-maktaba.org
  let lines;
  if (nass.length) {
    lines = blocksToText(nass.map((n) => n.inner).join('\n')).filter((l) => arabicRatio(l) >= 0.3);
  } else {
    lines = blocksToText(body).filter((l) => l.length >= 25 && arabicRatio(l) >= 0.7); // cadangan: buang menu dan teks pendek
  }
  return { title, teks: lines.join('\n') };
}

/** "ص3 - Nama Kitab - Bab - المكتبة الشاملة" -> {hal:'3', nama:'Nama Kitab'} */
export function parseTitle(title) {
  const m = /^ص\s*(\d+)\s+-\s+(.+?)\s+-\s+/.exec(title);
  return m ? { hal: m[1], nama: m[2].trim() } : { hal: '', nama: '' };
}

function cutAtBoundary(text, max) {
  if (text.length <= max) return { teks: text, terpotong: false };
  const slice = text.slice(0, max);
  const nl = slice.lastIndexOf('\n');
  return { teks: (nl > max * 0.5 ? slice.slice(0, nl) : slice).trim(), terpotong: true };
}

/* ------------------------------------------------------------------- Fetch */
async function readCapped(res, maxBytes) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { try { await reader.cancel(); } catch {} throw new ApiError(422, 'SUMBER_TOO_LARGE', 'Halaman sumber terlalu besar untuk diproses.'); }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  const buf = Buffer.from(await res.text());
  if (buf.length > maxBytes) throw new ApiError(422, 'SUMBER_TOO_LARGE', 'Halaman sumber terlalu besar untuk diproses.');
  return buf;
}

export async function fetchKitab(rawUrl, { allowedHosts = DEFAULT_HOSTS, fetchImpl = fetch, maxBytes = 2_000_000, timeoutMs = 10_000 } = {}) {
  let url = parseKitabUrl(rawUrl, allowedHosts);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetchImpl(url.href, {
        redirect: 'manual', signal: ctl.signal,
        headers: { 'User-Agent': 'BankSoalMadrasah/1.0 (alat bantu guru; satu halaman per permintaan)', Accept: 'text/html,text/plain;q=0.9', 'Accept-Language': 'ar,id;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= 3) throw new ApiError(502, 'SUMBER_ERROR', 'Situs sumber terlalu banyak mengalihkan.');
        url = parseKitabUrl(new URL(res.headers.get('location'), url).href, allowedHosts); // domain tujuan diperiksa ulang
        continue;
      }
      break;
    }
    if (res.status === 404) throw new ApiError(404, 'SUMBER_NOT_FOUND', 'Halaman tidak ditemukan di situs sumber. Periksa tautannya.');
    if (res.status === 429 || res.status === 403) throw new ApiError(502, 'SUMBER_BLOCKED', 'Situs sumber menolak permintaan otomatis. Salin teksnya manual lalu tempel di kolom teks.');
    if (res.status !== 200) throw new ApiError(502, 'SUMBER_ERROR', `Situs sumber membalas dengan kode ${res.status}.`);

    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const plain = type.startsWith('text/plain');
    if (!plain && !type.includes('html')) throw new ApiError(422, 'SUMBER_BUKAN_TEKS', 'Tautan ini bukan halaman teks (mungkin PDF atau gambar).');
    const charset = /charset=([\w-]+)/.exec(type)?.[1] || 'utf-8';
    const bytes = await readCapped(res, maxBytes);
    let html;
    try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder('utf-8').decode(bytes); }

    const { title, teks } = htmlToArabicText(html, { plain });
    if (teks.replace(/[^\p{L}]/gu, '').length < 15 || arabicRatio(teks) < 0.5) {
      throw new ApiError(422, 'TEKS_TIDAK_DITEMUKAN', 'Tidak ada teks Arab yang bisa diambil dari halaman ini. Salin teksnya manual lalu tempel di kolom teks.');
    }
    const cut = cutAtBoundary(teks, MAX_TEKS);
    return { url: url.href, host: url.hostname, judul: title.slice(0, 200), ...parseTitle(title), teks: cut.teks, terpotong: cut.terpotong };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === 'AbortError') throw new ApiError(504, 'SUMBER_TIMEOUT', 'Situs sumber terlalu lama merespons. Coba lagi.');
    throw new ApiError(502, 'SUMBER_ERROR', 'Tidak dapat menjangkau situs sumber. Coba lagi nanti.');
  } finally { clearTimeout(timer); }
}
