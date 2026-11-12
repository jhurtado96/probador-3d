import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, apiErrorMessage, errorMessage, functionUrl, parseApiError } from '../src/lib/apiErrors.ts';

test('functionUrl fija la región por parámetro (M3) y admite subrutas', () => {
  assert.equal(
    functionUrl('https://x.supabase.co/', 'create-job', 'eu-west-3'),
    'https://x.supabase.co/functions/v1/create-job?forceFunctionRegion=eu-west-3',
  );
  assert.equal(
    functionUrl('https://x.supabase.co', 'create-job/uploaded', 'eu-west-3'),
    'https://x.supabase.co/functions/v1/create-job/uploaded?forceFunctionRegion=eu-west-3',
  );
  assert.equal(functionUrl('https://x.supabase.co', 'export-data', 'any'), 'https://x.supabase.co/functions/v1/export-data');
});

test('parseApiError lee ApiErrorBody', () => {
  const e = parseApiError(403, JSON.stringify({ error: { code: 'consent_missing', message: 'no consent' } }));
  assert.ok(e instanceof ApiError);
  assert.equal(e.status, 403);
  assert.equal(e.code, 'consent_missing');
  assert.equal(errorMessage(e), apiErrorMessage('consent_missing'));
});

test('parseApiError con cuerpos que no son del contrato', () => {
  assert.equal(parseApiError(401, '{"msg":"Invalid JWT"}').code, 'unauthorized');
  assert.equal(parseApiError(502, '<html>').code, 'unknown');
  assert.equal(parseApiError(500, '').code, 'unknown');
});

test('errorMessage: errores de supabase-js genéricos, errores propios tal cual', () => {
  assert.match(errorMessage({ code: '42501', message: 'permission denied' }), /No se pudo completar/);
  assert.match(errorMessage(new TypeError('Failed to fetch')), /conexión/);
  assert.equal(errorMessage(new Error('Mensaje propio.')), 'Mensaje propio.');
  assert.match(errorMessage(undefined), /inesperado/);
});
