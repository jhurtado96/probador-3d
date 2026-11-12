import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeJob, isTerminal, jobErrorMessage, type JobLike } from '../src/lib/jobStatus.ts';

const base: JobLike = { type: 'avatar', status: 'queued', progress: 0, error: null, input_deleted_at: null };

test('cola: no terminal, sin progreso, la foto se borrará al terminar', () => {
  const v = describeJob(base);
  assert.equal(v.phase, 'queued');
  assert.equal(v.terminal, false);
  assert.equal(v.progress, null);
  assert.match(v.photoNote ?? '', /se borrará en cuanto termine/);
});

test('en curso: progreso acotado y etapa traducida', () => {
  const v = describeJob({ ...base, status: 'running', progress: 1.7, stage: 'segmenting' });
  assert.equal(v.progress, 1);
  assert.match(v.message, /silueta/);
  assert.equal(describeJob({ ...base, status: 'running', progress: Number.NaN }).progress, 0);
  assert.match(describeJob({ ...base, status: 'running', progress: 0.2, stage: 'desconocida' }).message, /avatar/);
});

test('not_implemented: mensaje amable, foto borrada, sin reintento', () => {
  const v = describeJob({
    ...base,
    status: 'failed',
    error: { code: 'not_implemented', message: 'no pipeline', retryable: true },
    input_deleted_at: '2026-11-12T13:13:21Z',
  });
  assert.equal(v.terminal, true);
  assert.equal(v.title, 'Todavía no disponible');
  assert.equal(v.message, 'El generador de avatares todavía no está disponible.');
  assert.equal(v.photoNote, 'Tu foto ya se ha borrado.');
  assert.equal(v.retryable, false);
});

test('fallo terminal sin borrado anotado: avisa del barrido de una hora', () => {
  const v = describeJob({ ...base, status: 'failed', error: { code: 'timeout', message: 'x', retryable: true } });
  assert.match(v.photoNote ?? '', /menos de una hora/);
  assert.equal(v.retryable, true);
});

test('fallo sin objeto error se trata como internal', () => {
  const v = describeJob({ ...base, status: 'failed', error: null });
  assert.equal(v.message, jobErrorMessage('internal', 'avatar'));
});

test('éxito y drapeado sin foto', () => {
  const v = describeJob({ ...base, type: 'drape', status: 'succeeded', progress: 1 });
  assert.equal(v.progress, 1);
  assert.equal(v.photoNote, null);
});

test('prendas: mensajes propios', () => {
  assert.match(jobErrorMessage('person_detected', 'garment'), /persona/);
  assert.match(jobErrorMessage('not_implemented', 'garment'), /prendas/);
  assert.match(describeJob({ ...base, type: 'garment', input_deleted_at: 'x' }).photoNote ?? '', /^Las fotos de la prenda/);
});

test('estados terminales', () => {
  assert.deepEqual(
    (['queued', 'running', 'succeeded', 'failed', 'canceled'] as const).map(isTerminal),
    [false, false, true, true, true],
  );
});
