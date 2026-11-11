// Test unitario de la firma entre API y workers (no necesita el stack local):
//   deno test --config functions/deno.json --allow-read tests/unit/
// El vector lo comprueban también packages/contracts (Node) y services/workers (Python).

import { strict as assert } from "node:assert";
import vector from "@probador/contracts/fixtures/signature-vector.json" with { type: "json" };
import {
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  signBody,
  signedHeaders,
  verifyRequest,
  verifySignature,
} from "../../functions/_shared/hmac.ts";

const at = (seconds: number) => seconds * 1000;

Deno.test("firma: vector compartido del contrato", async () => {
  assert.equal(await signBody(vector.secret, vector.body, vector.timestamp), vector.signature);
  const now = at(Number(vector.timestamp) + 10);
  assert.equal(await verifySignature(vector.secret, vector.body, vector.signature, vector.timestamp, now), true);
});

Deno.test("firma: rechaza manipulación, secreto ajeno, cabeceras ausentes y reenvíos", async () => {
  const now = at(1_800_000_000);
  const body = '{"job_id":"x"}';
  const h = new Headers(await signedHeaders("secreto", body, now));
  const sig = h.get(SIGNATURE_HEADER);
  const ts = h.get(SIGNATURE_TIMESTAMP_HEADER);
  assert.equal(await verifyRequest("secreto", body, h, now), true);
  assert.equal(await verifyRequest("secreto", body + " ", h, now), false);
  assert.equal(await verifyRequest("otro", body, h, now), false);
  assert.equal(await verifyRequest("", body, h, now), false);
  assert.equal(await verifySignature("secreto", body, sig, null, now), false);
  assert.equal(await verifySignature("secreto", body, null, ts, now), false);
  assert.equal(await verifySignature("secreto", body, sig!.slice("sha256=".length), ts, now), false, "sin prefijo");
  // Ventana de tolerancia de 300 s en ambos sentidos.
  assert.equal(await verifyRequest("secreto", body, h, now + at(300)), true);
  assert.equal(await verifyRequest("secreto", body, h, now + at(301)), false);
  assert.equal(await verifyRequest("secreto", body, h, now - at(301)), false);
  // Cambiar el timestamp sin el secreto invalida la firma.
  assert.equal(await verifySignature("secreto", body, sig, String(1_800_000_200), now + at(200)), false);
});
