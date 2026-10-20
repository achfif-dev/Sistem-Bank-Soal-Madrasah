// Logika murni (mudah diuji): peran, domain email, dan batas pemakaian per pengguna.

export const STAFF = ['penyusun', 'editor', 'admin'];

export const parseList = (s) =>
  String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Admin pertama ditentukan dari ADMIN_EMAILS, hanya jika email Google sudah terverifikasi. */
export const initialRole = (email, verified, admins) =>
  verified && admins.includes(String(email || '').toLowerCase()) ? 'admin' : 'pending';

/** Jika ALLOWED_EMAIL_DOMAIN diisi (mis. "madrasahku.sch.id"), hanya email domain itu yang boleh masuk. */
export const domainAllowed = (email, domain) => {
  const d = String(domain || '').trim().toLowerCase().replace(/^@/, '');
  if (!d) return true;
  return String(email || '').toLowerCase().endsWith('@' + d);
};

const WIB = 7 * 3600 * 1000;

/**
 * Keputusan batas pemakaian. `state` = dokumen rate/{uid} sebelumnya (boleh kosong).
 * Mengembalikan {ok:true, state} atau {ok:false, code, retryAfter}.
 */
export function rateDecision(state, now, { perMinute, perDay }) {
  const s = { minStart: 0, minCount: 0, dayKey: '', dayCount: 0, ...(state || {}) };
  const dayKey = new Date(now + WIB).toISOString().slice(0, 10); // hari menurut WIB
  if (s.dayKey !== dayKey) { s.dayKey = dayKey; s.dayCount = 0; }
  if (now - s.minStart >= 60_000) { s.minStart = now; s.minCount = 0; }

  if (s.dayCount >= perDay) {
    const nextMidnight = Math.floor((now + WIB) / 86_400_000) * 86_400_000 + 86_400_000 - WIB;
    return { ok: false, code: 'RATE_LIMIT_DAILY', retryAfter: Math.ceil((nextMidnight - now) / 1000) };
  }
  if (s.minCount >= perMinute) {
    return { ok: false, code: 'RATE_LIMIT_LOCAL', retryAfter: Math.max(1, Math.ceil((s.minStart + 60_000 - now) / 1000)) };
  }
  s.minCount += 1;
  s.dayCount += 1;
  return { ok: true, state: s };
}
