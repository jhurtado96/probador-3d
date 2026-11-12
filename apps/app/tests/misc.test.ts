import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ConsentText } from '@probador/contracts';

import { authErrorMessage, validateCredentials } from '../src/lib/authErrors.ts';
import { joinChunks, splitIntoChunks } from '../src/lib/chunks.ts';
import { latestTextPerPurpose } from '../src/lib/consentTexts.ts';
import { validateHeightCm, validateWeightKg } from '../src/lib/height.ts';

test('trozos de SecureStore: ida y vuelta, ≤ 1800 bytes, sin partir emojis', () => {
  const value = JSON.stringify({ token: 'a'.repeat(3000), name: 'Ñandú 😀'.repeat(200) });
  const chunks = splitIntoChunks(value);
  assert.equal(joinChunks(chunks), value);
  for (const c of chunks) assert.ok(Buffer.byteLength(c, 'utf8') <= 1800);
  assert.ok(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c)));
  assert.equal(joinChunks(['a', null]), null);
  assert.equal(joinChunks([]), null);
  assert.deepEqual(splitIntoChunks(''), ['']);
});

test('texto vigente: el último publicado de cada tratamiento', () => {
  const t = (version: string, published_at: string, purpose: ConsentText['purpose'] = 'body_scan'): ConsentText => ({
    purpose,
    version,
    published_at,
    body: version,
    sha256: '0'.repeat(64),
  });
  const out = latestTextPerPurpose([
    t('v1', '2026-11-11T00:00:00+00:00'),
    t('v3', '2026-12-01T00:00:00+00:00'),
    t('v2', '2026-11-20T00:00:00+00:00'),
    t('c1', '2026-11-11T00:00:00+00:00', 'color_analysis'),
  ]);
  assert.equal(out.body_scan?.version, 'v3');
  assert.equal(out.color_analysis?.version, 'c1');
  assert.equal(out.analytics, undefined);
});

test('altura y peso', () => {
  assert.deepEqual(validateHeightCm('172,5'), { ok: true, valueCm: 172.5 });
  assert.equal(validateHeightCm('').ok, false);
  assert.deepEqual(validateWeightKg(''), { ok: true, valueKg: undefined });
  assert.deepEqual(validateWeightKg('68,5'), { ok: true, valueKg: 68.5 });
  assert.equal(validateWeightKg('5').ok, false);
  assert.equal(validateWeightKg('400').ok, false);
});

test('auth: validación y mensajes', () => {
  assert.equal(validateCredentials('mal', 'x', 'signIn'), 'Escribe un email válido.');
  assert.match(validateCredentials('a@b.es', 'corta', 'signUp') ?? '', /8 caracteres/);
  assert.equal(validateCredentials('a@b.es', 'corta', 'signIn'), null);
  assert.match(authErrorMessage({ code: 'invalid_credentials' }), /incorrectos/);
  assert.match(authErrorMessage({ code: 'email_not_confirmed' }), /confirmado/);
  assert.match(authErrorMessage({ message: 'Failed to fetch' }), /conexión/);
  assert.match(authErrorMessage(null), /No se pudo/);
});
