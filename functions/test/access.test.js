import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList, initialRole, domainAllowed, rateDecision, STAFF } from '../src/access.js';

test('initialRole: admin hanya bila email ada di daftar DAN terverifikasi', () => {
  const admins = parseList(' Admin@Madrasah.sch.id , kepala@gmail.com ,');
  assert.deepEqual(admins, ['admin@madrasah.sch.id', 'kepala@gmail.com']);
  assert.equal(initialRole('ADMIN@madrasah.sch.id', true, admins), 'admin');
  assert.equal(initialRole('admin@madrasah.sch.id', false, admins), 'pending');
  assert.equal(initialRole('guru@gmail.com', true, admins), 'pending');
  assert.equal(initialRole(undefined, true, admins), 'pending');
});

test('domainAllowed', () => {
  assert.equal(domainAllowed('a@b.com', ''), true);
  assert.equal(domainAllowed('guru@madrasahku.sch.id', '@madrasahku.sch.id'), true);
  assert.equal(domainAllowed('guru@evil-madrasahku.sch.id', 'madrasahku.sch.id'), false);
  assert.equal(domainAllowed('guru@gmail.com', 'madrasahku.sch.id'), false);
});

test('rateDecision: batas per menit, reset jendela, batas harian WIB', () => {
  const lim = { perMinute: 3, perDay: 5 };
  const t0 = Date.UTC(2026, 9, 20, 3, 0, 0); // 10:00 WIB
  let st;
  for (let i = 0; i < 3; i++) { const d = rateDecision(st, t0 + i * 1000, lim); assert.ok(d.ok); st = d.state; }
  const blocked = rateDecision(st, t0 + 5000, lim);
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'RATE_LIMIT_LOCAL'); assert.equal(blocked.retryAfter, 55);
  const later = rateDecision(st, t0 + 61_000, lim); // jendela baru
  assert.ok(later.ok); st = later.state;
  const d5 = rateDecision(st, t0 + 62_000, lim); assert.ok(d5.ok); st = d5.state; // hitungan ke-5 hari ini
  const daily = rateDecision(st, t0 + 130_000, lim);
  assert.equal(daily.ok, false); assert.equal(daily.code, 'RATE_LIMIT_DAILY');
  assert.ok(daily.retryAfter > 3600 && daily.retryAfter <= 86400);
  const nextDay = rateDecision(st, t0 + 20 * 3600 * 1000, lim); // 06:00 WIB hari berikutnya
  assert.ok(nextDay.ok);
});

test('STAFF tidak memuat pending/nonaktif', () => {
  assert.deepEqual(STAFF, ['penyusun', 'editor', 'admin']);
});
