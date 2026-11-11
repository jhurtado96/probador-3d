// Firma HMAC-SHA256 de los callbacks del worker (cabecera x-probador-signature).
//
// Formato aceptado: `sha256=<hex>` o `<hex>` a secas, calculado sobre el cuerpo
// HTTP exacto (bytes UTF-8) con JOB_CALLBACK_SECRET.

export const SIGNATURE_HEADER = "x-probador-signature";

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

export async function signBody(secret: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `sha256=${toHex(sig)}`;
}

/** Verificación en tiempo constante (crypto.subtle.verify). */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const hex = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  const expected = fromHex(hex.trim());
  if (!expected) return false;
  return await crypto.subtle.verify("HMAC", await hmacKey(secret), expected, encoder.encode(body));
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
