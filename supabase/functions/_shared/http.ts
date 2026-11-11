// Respuestas HTTP comunes. Los errores de la API siguen la forma
// `{ "error": { "code": string, "message": string, "details"?: unknown } }`.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      err.status,
    );
  }
  // Nunca se registran cuerpos de petición, URLs firmadas ni medidas: solo el error.
  const message = (err as { message?: unknown })?.message;
  console.error("unhandled error", typeof message === "string" ? message : String(err));
  return json({ error: { code: "internal", message: "internal error" } }, 500);
}

/** Envuelve un handler: CORS, preflight y errores uniformes. */
export function handler(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "request body is not valid JSON");
  }
}
