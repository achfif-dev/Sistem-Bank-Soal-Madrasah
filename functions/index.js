// Cloud Functions (generasi 2) untuk Bank Soal Madrasah.
//   POST /api/session   membuat/menyegarkan profil pengguna setelah login Google
//   POST /api/generate  menyusun soal baru dengan Claude
//   POST /api/assist    terjemah teks, analisis teks, telaah dan perbaikan soal (Claude)
//   POST /api/kitab     mengambil satu halaman teks kitab dari situs perpustakaan online yang diizinkan
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString, defineInt } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { generateSoal, validateInput, toApiError, ApiError, getModel } from './src/soalService.js';
import { terjemahTeks, analisisTeks, telaahSoal, validateTeks } from './src/assistService.js';
import { fetchKitab, DEFAULT_HOSTS } from './src/kitabFetch.js';
import { STAFF, parseList, initialRole, domainAllowed, rateDecision } from './src/access.js';

const REGION = 'asia-southeast2'; // Jakarta. Samakan dengan lokasi Firestore.

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: '' });
const ALLOWED_EMAIL_DOMAIN = defineString('ALLOWED_EMAIL_DOMAIN', { default: '' });
const KITAB_ALLOWED_HOSTS = defineString('KITAB_ALLOWED_HOSTS', { default: DEFAULT_HOSTS.join(',') });
const LIMIT_PER_MINUTE = defineInt('LIMIT_PER_MINUTE', { default: 8 }); // semua panggilan AI
const LIMIT_PER_DAY = defineInt('LIMIT_PER_DAY', { default: 100 });
const LIMIT_KITAB_PER_MINUTE = defineInt('LIMIT_KITAB_PER_MINUTE', { default: 10 });
const LIMIT_KITAB_PER_DAY = defineInt('LIMIT_KITAB_PER_DAY', { default: 200 });

initializeApp();
const db = getFirestore();

const AUTH_MSG = 'Sesi berakhir. Masuk lagi dengan akun Google Anda.';

async function authenticate(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new ApiError(401, 'AUTH_REQUIRED', AUTH_MSG);
  try {
    return await getAuth().verifyIdToken(m[1]);
  } catch {
    throw new ApiError(401, 'AUTH_REQUIRED', AUTH_MSG);
  }
}

/** Login valid DAN peran aktif (penyusun, editor, admin). */
async function authenticateStaff(req) {
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Gunakan metode POST.');
  const u = await authenticate(req);
  const snap = await db.doc(`users/${u.uid}`).get();
  if (!snap.exists || !STAFF.includes(snap.data().role)) {
    throw new ApiError(403, 'FORBIDDEN_ROLE', 'Akun Anda belum disetujui admin untuk memakai fitur ini.');
  }
  return u;
}

function reply(res, status, json, headers = {}) {
  res.set({ 'Cache-Control': 'no-store', ...headers });
  return res.status(status).json(json);
}

function replyError(res, e) {
  const err = toApiError(e);
  if (!(e instanceof ApiError)) console.error('[api] error tak terduga:', e?.status, e?.message); // jangan bocorkan ke klien
  return reply(
    res,
    err.status,
    { error: { code: err.code, message: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) } },
    err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {},
  );
}

/** Batas per pengguna yang berlaku di semua instance (Firestore: rate/{uid} dan rate/{uid}_kitab). */
async function enforceRate(docId, limits) {
  const ref = db.doc(`rate/${docId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = rateDecision(snap.data(), Date.now(), limits);
    if (!d.ok) {
      const msg = d.code === 'RATE_LIMIT_DAILY'
        ? 'Kuota harian Anda untuk fitur ini habis. Coba lagi besok.'
        : `Terlalu banyak permintaan. Coba lagi dalam ${d.retryAfter} detik.`;
      throw new ApiError(429, d.code, msg, { retryAfter: d.retryAfter });
    }
    tx.set(ref, d.state);
  });
}
const aiLimits = () => ({ perMinute: LIMIT_PER_MINUTE.value(), perDay: LIMIT_PER_DAY.value() });

export const session = onRequest({ region: REGION, maxInstances: 5, cors: false }, async (req, res) => {
  try {
    if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Gunakan metode POST.');
    const u = await authenticate(req);
    if (!u.email || !u.email_verified) throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Email akun Google Anda belum terverifikasi.');
    if (!domainAllowed(u.email, ALLOWED_EMAIL_DOMAIN.value())) {
      throw new ApiError(403, 'DOMAIN_NOT_ALLOWED', `Hanya akun dengan email @${ALLOWED_EMAIL_DOMAIN.value().replace(/^@/, '')} yang boleh masuk.`);
    }
    const wantedRole = initialRole(u.email, u.email_verified, parseList(ADMIN_EMAILS.value()));
    const ref = db.doc(`users/${u.uid}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const profile = { email: u.email, name: u.name || u.email, photoURL: u.picture || '', lastLoginAt: FieldValue.serverTimestamp() };
      if (!snap.exists) {
        tx.set(ref, { ...profile, role: wantedRole, createdAt: FieldValue.serverTimestamp() });
      } else {
        const patch = { ...profile };
        if (wantedRole === 'admin' && snap.data().role !== 'admin') patch.role = 'admin'; // email ada di ADMIN_EMAILS
        tx.update(ref, patch);
      }
    });
    return reply(res, 200, { ok: true });
  } catch (e) {
    return replyError(res, e);
  }
});

const AI_OPTS = { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: '512MiB', maxInstances: 5, cors: false };

export const generate = onRequest(AI_OPTS, async (req, res) => {
  try {
    const u = await authenticateStaff(req);
    validateInput(req.body); // tolak input cacat sebelum menghabiskan kuota
    await enforceRate(u.uid, aiLimits());
    const soal = await generateSoal(req.body);
    return reply(res, 200, { soal, model: getModel() });
  } catch (e) {
    return replyError(res, e);
  }
});

const ASSIST = { terjemah: terjemahTeks, analisis: analisisTeks, telaah: telaahSoal };

export const assist = onRequest(AI_OPTS, async (req, res) => {
  try {
    const u = await authenticateStaff(req);
    const run = ASSIST[req.body && req.body.aksi];
    if (!run) throw new ApiError(400, 'BAD_REQUEST', 'Aksi harus terjemah, analisis, atau telaah.');
    if (req.body.aksi === 'telaah') validateInput(req.body); else validateTeks(req.body);
    await enforceRate(u.uid, aiLimits());
    const hasil = await run(req.body);
    return reply(res, 200, { aksi: req.body.aksi, hasil, model: getModel() });
  } catch (e) {
    return replyError(res, e);
  }
});

export const kitab = onRequest({ region: REGION, timeoutSeconds: 30, memory: '256MiB', maxInstances: 5, cors: false }, async (req, res) => {
  try {
    const u = await authenticateStaff(req);
    await enforceRate(`${u.uid}_kitab`, { perMinute: LIMIT_KITAB_PER_MINUTE.value(), perDay: LIMIT_KITAB_PER_DAY.value() });
    const sumber = await fetchKitab(req.body && req.body.url, { allowedHosts: parseList(KITAB_ALLOWED_HOSTS.value()) });
    return reply(res, 200, { sumber });
  } catch (e) {
    return replyError(res, e);
  }
});
