import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contentTypeFor,
  isOwnRawUploadPath,
  randomId,
  rawUploadPath,
  resizeTarget,
  splitStoragePath,
} from '../src/lib/uploadPaths.ts';

const UID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

test('rawUploadPath cumple la regla de create-job', () => {
  const p = rawUploadPath(UID);
  assert.ok(isOwnRawUploadPath(p, UID), p);
  assert.match(p, /^raw-uploads\/[^/]+\/[0-9a-f]{32}\.jpg$/);
  assert.ok(!isOwnRawUploadPath(p, 'otro-usuario'));
  assert.ok(!isOwnRawUploadPath(`raw-uploads/${UID}/../x.jpg`, UID));
  assert.ok(!isOwnRawUploadPath(`raw-uploads/${UID}/x.gif`, UID));
  assert.throws(() => rawUploadPath(UID, 'jpg', 'con espacios'));
});

test('randomId: 32 hex y distintos', () => {
  const a = randomId();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, randomId());
});

test('splitStoragePath y contentTypeFor', () => {
  assert.deepEqual(splitStoragePath('assets/u/avatars/a.glb'), { bucket: 'assets', name: 'u/avatars/a.glb' });
  assert.throws(() => splitStoragePath('sinbucket'));
  assert.throws(() => splitStoragePath('assets/'));
  assert.equal(contentTypeFor('raw-uploads/u/a.JPG'), 'image/jpeg');
  assert.equal(contentTypeFor('raw-uploads/u/a.png'), 'image/png');
  assert.equal(contentTypeFor('raw-uploads/u/a.webp'), 'image/webp');
});

test('resizeTarget: lado mayor ≤ 2048', () => {
  assert.equal(resizeTarget(1500, 2000), null);
  assert.deepEqual(resizeTarget(3000, 4000), { height: 2048 });
  assert.deepEqual(resizeTarget(4000, 3000), { width: 2048 });
  assert.deepEqual(resizeTarget(0, 0), { width: 2048 });
});
