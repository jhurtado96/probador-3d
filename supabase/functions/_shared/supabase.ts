import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.ts";
import { HttpError } from "./http.ts";

/**
 * Cliente con la clave de servicio: salta RLS. Solo vive en las Edge
 * Functions; nunca se devuelve nada de él sin comprobar antes el dueño.
 */
export function adminClient(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Usuario autenticado de la petición (JWT de Supabase Auth en Authorization). */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<{ id: string }> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new HttpError(401, "unauthorized", "missing bearer token");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "invalid or expired token");
  return { id: data.user.id };
}
