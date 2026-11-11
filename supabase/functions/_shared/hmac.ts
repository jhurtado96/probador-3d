// Firma HMAC-SHA256 entre la API y los workers (packages/contracts, «Firma de
// peticiones entre API y workers»). Vale igual para el despacho que sale
// (PROBADOR_DISPATCH_SECRET) y para el callback que entra (PROBADOR_CALLBACK_SECRET):
//
//   x-probador-timestamp: <segundos Unix>
//   x-probador-signature: sha256=<hex(HMAC-SHA256(secreto, "<timestamp>." + cuerpo exacto))>
//
// Se rechaza si falta una cabecera, si la firma no coincide o si el timestamp
// se aleja más de SIGNATURE_TOLERANCE_SECONDS del reloj (protección contra reenvíos).

import {
  SIGNATURE_HEADER,
  SIGNATURE_PREFIX,
  SIGNATURE_TIMESTAMP_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
} from "@probador/contracts";

export { SIGNATURE_HEADER, SIGNATURE_TIMESTAMP_HEADER };

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signBody(secret: string, body: string, timestamp: string | number): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${timestamp}.${body}`));
  return `${SIGNATURE_PREFIX}${toHex(sig)}`;
}

/** Cabeceras de una petición firmada ahora. */
export async function signedHeaders(
  secret: string,
  body: string,
  nowMs: number = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [SIGNATURE_TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await signBody(secret, body, timestamp),
  };
}

/** Verificación en tiempo constante (crypto.subtle.verify) de la firma y de la frescura del timestamp. */
export async function verifySignature(
  secret: string,
  body: string,
  signature: string | null,
  timestamp: string | null,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret || !signature || !timestamp) return false;
  const ts = timestamp.trim();
  if (!/^[0-9]{1,12}$/.test(ts)) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const sig = signature.trim();
  if (!sig.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = fromHex(sig.slice(SIGNATURE_PREFIX.length));
  if (!expected) return false;
  return await crypto.subtle.verify("HMAC", await hmacKey(secret), expected, encoder.encode(`${ts}.${body}`));
}

export async function verifyRequest(secret: string, body: string, headers: Headers, nowMs?: number): Promise<boolean> {
  return await verifySignature(
    secret,
    body,
    headers.get(SIGNATURE_HEADER),
    headers.get(SIGNATURE_TIMESTAMP_HEADER),
    nowMs,
  );
}

/** Comparación de secretos compartidos en tiempo constante. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey("compare");
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
