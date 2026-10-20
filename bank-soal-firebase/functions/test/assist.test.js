import test from 'node:test';
import assert from 'node:assert/strict';
import { terjemahTeks, analisisTeks, telaahSoal, validateSoalDraft } from '../src/assistService.js';
import { generateSoal } from '../src/soalService.js';

const TEKS = 'الْمِيَاهُ الَّتِي يَجُوزُ بِهَا التَّطْهِيرُ سَبْعُ مِيَاهٍ: مَاءُ السَّمَاءِ، وَمَاءُ الْبَحْرِ، وَمَاءُ النَّهْرِ';
const fake = (content, stop = 'tool_use') => { const calls = []; return { calls, messages: { create: async (r) => { calls.push(r); return { stop_reason: stop, content }; } } }; };
const tool = (name, input) => [{ type: 'tool_use', name, input }];

const soal = {
  stimulus: 'Santri kehabisan air tawar.', pertanyaan: 'Air apa yang sah?',
  opsi: { A: 'Air kelapa', B: 'Air laut', C: 'Air teh', D: 'Air mawar', E: 'Air jeruk' }, kunci: 'B', pembahasan: 'مَاءُ الْبَحْرِ', indikator: '',
};
const fixed = {
  stimulus: 'Santri berkemah di pantai dan kehabisan air tawar.', pertanyaan: 'Air manakah yang sah untuk berwudhu?',
  pilihan_a: 'Air kelapa', pilihan_b: 'Air laut', pilihan_c: 'Air teh', pilihan_d: 'Air mawar', pilihan_e: 'Air jeruk',
  kunci_jawaban: 'B', pembahasan: 'مَاءُ الْبَحْرِ termasuk tujuh air.', indikator_kisi_kisi: 'Peserta didik dapat menganalisis jenis air.',
};

test('terjemah: hasil dinormalisasi, teks non-Arab ditolak sebelum memanggil AI', async () => {
  const c = fake(tool('hasil_terjemah', { terjemah: 'Air yang boleh dipakai bersuci ada tujuh.', poin_inti: ['a', 'b'], istilah: [{ arab: 'مَاءُ', arti: 'air' }, { arab: '', arti: 'x' }] }));
  const r = await terjemahTeks({ teks: TEKS, nama: 'Fathul Qarib' }, { client: c });
  assert.equal(r.istilah.length, 1);
  assert.match(c.calls[0].system, /Ahlussunnah wal Jamaah/);
  assert.match(c.calls[0].messages[0].content, /<teks_kitab>/);
  await assert.rejects(terjemahTeks({ teks: 'plain english text only here, long enough' }, { client: c }), { code: 'INVALID_ARABIC' });
  assert.equal(c.calls.length, 1);
});

test('terjemah: tolak_teks dan keluaran kosong', async () => {
  await assert.rejects(terjemahTeks({ teks: TEKS }, { client: fake(tool('tolak_teks', { alasan: 'Terpotong.' })) }), { code: 'TEKS_TIDAK_MEMADAI', message: 'Terpotong.' });
  await assert.rejects(terjemahTeks({ teks: TEKS }, { client: fake(tool('hasil_terjemah', { terjemah: '' })) }), { code: 'AI_BAD_OUTPUT' });
  await assert.rejects(terjemahTeks({ teks: TEKS }, { client: fake(tool('hasil_analisis', {})) }), { code: 'AI_BAD_OUTPUT' });
});

test('analisis: ide soal dengan level salah dibuang, kosong ditolak', async () => {
  const ok = fake(tool('hasil_analisis', { tema: 'Air bersuci', kandungan: ['Ada tujuh air'], ide_soal: [{ level: 'L1', fokus: 'Jumlah air', alasan: 'x' }, { level: 'L9', fokus: 'salah', alasan: 'y' }], potensi_pengecoh: ['Air kelapa'], catatan_khilaf: '' }));
  const r = await analisisTeks({ teks: TEKS, tingkat: 'MTs' }, { client: ok });
  assert.equal(r.ide_soal.length, 1);
  assert.match(ok.calls[0].messages[0].content, /Tsanawiyah/);
  await assert.rejects(analisisTeks({ teks: TEKS }, { client: fake(tool('hasil_analisis', { tema: 't', ide_soal: [] })) }), { code: 'AI_BAD_OUTPUT' });
});

test('telaah: temuan dan perbaikan dinormalisasi; draft kosong ditolak', async () => {
  const c = fake(tool('hasil_telaah', { verdict: 'perlu_perbaikan', temuan: [{ aspek: 'kejelasan', tingkat: 'kritis', masalah: 'Ambigu', saran: 'Perjelas' }, { aspek: 'aneh', tingkat: 'x', masalah: 'M', saran: 'S' }, { aspek: 'bahasa', masalah: '', saran: '' }], perbaikan: fixed, ringkasan_perubahan: 'Stimulus dilengkapi.' }));
  const r = await telaahSoal({ teks: TEKS, nama: 'Fathul Qarib', tingkat: 'MA', level: 'L3', soal }, { client: c });
  assert.equal(r.temuan.length, 2);
  assert.equal(r.temuan[1].aspek, 'kejelasan'); assert.equal(r.temuan[1].tingkat, 'saran');
  assert.equal(r.perbaikan.kunci_jawaban, 'B');
  assert.match(c.calls[0].messages[0].content, /<soal_draft>/);
  assert.throws(() => validateSoalDraft({ pertanyaan: '', opsi: {} }), { code: 'SOAL_KOSONG' });
  assert.throws(() => validateSoalDraft({ pertanyaan: 'x', opsi: { A: 'a' } }), { code: 'SOAL_KOSONG' });
  const bad = fake(tool('hasil_telaah', { verdict: 'layak', temuan: [], perbaikan: { ...fixed, pilihan_a: 'Air laut' }, ringkasan_perubahan: '' }));
  await assert.rejects(telaahSoal({ teks: TEKS, tingkat: 'MA', level: 'L3', soal }, { client: bad }), { code: 'AI_BAD_OUTPUT' });
});

test('generate: fokus dari analisis ikut ke prompt', async () => {
  const c = fake(tool('buat_soal', fixed));
  await generateSoal({ teks: TEKS, tingkat: 'MA', level: 'L3', fokus: 'Jumlah air yang sah untuk bersuci' }, { client: c });
  assert.match(c.calls[0].messages[0].content, /Fokus soal.*Jumlah air/);
  assert.match(c.calls[0].system, /Ahlussunnah wal Jamaah/);
});
