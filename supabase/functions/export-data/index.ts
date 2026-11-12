// GET /functions/v1/export-data — exportación de datos (arts. 15 y 20 RGPD; docs/architecture.md §7, D7)
//
// Devuelve un DataExport (packages/contracts) con todos los datos del usuario:
// cuenta, perfil, consentimientos, avatares con medidas, perfiles de color,
// prendas con medidas, fit_results, user_fit_preferences, outfits, caché de
// drapeado, embeddings de sus prendas y jobs (todo lo que queda de la fila:
// entrada sin rutas de Storage y salida, que son solo ids; A1 y B11), más URLs
// firmadas de 1 h a sus GLB, patrones, recortes y miniaturas. Las fotos
// originales no se exportan porque no se conservan.
//
// Seguridad: las filas se leen con el JWT del usuario (RLS) y además se
// filtran por su user_id; solo se firman rutas de su carpeta `assets/<uid>/`.
// La respuesta se valida contra el JSON Schema de DataExport antes de salir.
// Cuota: DATA_EXPORT_DAILY_QUOTA (5) por usuario y 24 h → 429 quota_exceeded.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTRACTS_VERSION,
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_SIGNED_URL_TTL_SECONDS,
  type DataExport,
  type DataExportGarmentEmbedding,
  type DataExportJob,
  type DataExportJobInput,
  GARMENT_EMBEDDING_DIMENSIONS,
  JOB_RETENTION_DAYS,
  type JobResult,
} from "../_shared/contracts.ts";
import { validate } from "../_shared/validate_export.ts";
import { env } from "../_shared/env.ts";
import { corsHeaders, handler, HttpError } from "../_shared/http.ts";
import { ASSETS_BUCKET, publicUrl, splitPath } from "../_shared/storage.ts";
import { adminClient, requireUser, userClient } from "../_shared/supabase.ts";

/** Igual que `max_rows` de PostgREST (config.toml): se pagina para no truncar. */
const PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

/** Columnas de jobs que se exportan: todas las que ve el usuario (output son solo ids, A1). */
const JOB_COLUMNS =
  "id, type, status, progress, stage, input, output, error, attempts, worker_version, fake, input_deleted_at, created_at, started_at, finished_at";

const NOTES = [
  "Las fotos originales (cuerpo entero, selfie y fotos de prendas) no se conservan: se borran al terminar su " +
  "procesamiento y por eso no forman parte de esta exportación.",
  "Las URLs de ficheros (avatars[].glb_url, garments[].glb_url, garments[].sewing_pattern_url, garments[].image_url, " +
  "outfits[].preview_url y drape_cache[].glb_url) son temporales y caducan en signed_urls_expire_at. Una URL null " +
  "significa que el fichero ya no existe.",
  "Los GLB son glTF binario (malla en metros, Y arriba) y los patrones de costura son JSON de GarmentCode.",
  "Los jobs se exportan tal como se conservan: su salida son solo identificadores de lo que crearon (los datos están " +
  "en las demás secciones) y, una vez terminados, su entrada se reduce a identificadores; las rutas internas de " +
  `las fotos no se incluyen. Los jobs terminados se borran a los ${JOB_RETENTION_DAYS} días.`,
  "garment_embeddings contiene el vector numérico que describe la imagen de cada prenda propia (se usa para " +
  "recomendaciones y no se muestra en la app).",
  "Formato: JSON con el esquema DataExport de @probador/contracts, en la versión indicada en contracts_version.",
];

async function fetchAll(
  query: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchOne(query: PromiseLike<{ data: Row | null; error: unknown }>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Firma las rutas `assets/<uid>/…`; las que no existen (o no son del usuario) quedan en null. */
async function signPaths(
  admin: SupabaseClient,
  userId: string,
  paths: string[],
): Promise<Map<string, string | null>> {
  const signed = new Map<string, string | null>();
  const own = [...new Set(paths)].filter((p) => p.startsWith(`${ASSETS_BUCKET}/${userId}/`));
  for (const p of paths) signed.set(p, null);
  for (let i = 0; i < own.length; i += 100) {
    const batch = own.slice(i, i + 100);
    const names = batch.map((p) => splitPath(p).name);
    const { data, error } = await admin.storage.from(ASSETS_BUCKET)
      .createSignedUrls(names, DATA_EXPORT_SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(`createSignedUrls failed: ${error.message}`);
    for (const item of data ?? []) {
      if (item.error || !item.signedUrl || !item.path) continue;
      signed.set(`${ASSETS_BUCKET}/${item.path}`, publicUrl(item.signedUrl));
    }
  }
  return signed;
}

/** Sustituye la columna `<x>_path` por el campo `<x>_url` del contrato con la URL firmada. */
function withUrl(row: Row, column: string, signed: Map<string, string | null>): Row {
  const { [`${column}_path`]: path, ...rest } = row;
  return { ...rest, [`${column}_url`]: typeof path === "string" ? signed.get(path) ?? null : null };
}

/** pgvector llega por PostgREST como texto `[0.1,0.2,…]`. */
function parseVector(v: unknown): number[] | null {
  const arr = typeof v === "string" ? JSON.parse(v) : v;
  return Array.isArray(arr) && arr.length === GARMENT_EMBEDDING_DIMENSIONS && arr.every((x) => typeof x === "number")
    ? arr
    : null;
}

/** Entrada del job sin rutas de Storage (`*_path`, `*_paths`). */
function stripPaths(input: unknown): DataExportJobInput {
  const out: Row = {};
  for (const [k, v] of Object.entries((input ?? {}) as Row)) {
    if (!/_paths?$/.test(k)) out[k] = v;
  }
  return out as unknown as DataExportJobInput;
}

Deno.serve(handler(async (req) => {
  if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "use GET");
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const uid = user.id;

  const quota = env.dataExportDailyQuota();
  const { data: allowed, error: quotaErr } = await admin.rpc("register_data_export", {
    p_user_id: uid,
    p_daily_limit: quota,
  });
  if (quotaErr) throw quotaErr;
  if (allowed !== true) {
    throw new HttpError(429, "quota_exceeded", `data export quota exceeded (${quota} per 24 h)`, {
      limit: quota,
      window_hours: 24,
    });
  }

  const db = userClient(req);
  const [
    profile,
    consents,
    avatars,
    colorProfiles,
    garments,
    fitResults,
    preferences,
    outfits,
    drapeCache,
    embeddings,
    jobs,
  ] = await Promise.all([
    fetchOne(db.from("profiles").select("*").eq("id", uid).maybeSingle()),
    fetchAll((a, b) =>
      db.from("consents")
        .select("id, user_id, purpose, text_version, granted_at, withdrawn_at, created_at")
        .eq("user_id", uid).order("created_at").order("id").range(a, b)
    ),
    fetchAll((a, b) => db.from("avatars").select("*").eq("user_id", uid).order("created_at").order("id").range(a, b)),
    fetchAll((a, b) =>
      db.from("color_profiles").select("*").eq("user_id", uid).order("created_at").order("id").range(a, b)
    ),
    fetchAll((a, b) =>
      db.from("garments_with_measurements").select("*").eq("user_id", uid).order("created_at").order("id")
        .range(a, b)
    ),
    fetchAll((a, b) =>
      db.from("fit_results").select("*").eq("user_id", uid).order("created_at").order("id").range(a, b)
    ),
    fetchOne(db.from("user_fit_preferences").select("*").eq("user_id", uid).maybeSingle()),
    fetchAll((a, b) => db.from("outfits").select("*").eq("user_id", uid).order("created_at").order("id").range(a, b)),
    fetchAll((a, b) =>
      db.from("drape_cache").select("*").eq("user_id", uid).order("created_at").order("id").range(a, b)
    ),
    fetchAll((a, b) =>
      db.from("garments").select("id, embedding_model, embedding").eq("user_id", uid).not("embedding", "is", null)
        .order("created_at").order("id").range(a, b)
    ),
    fetchAll((a, b) =>
      db.from("jobs")
        .select(JOB_COLUMNS)
        .eq("user_id", uid).order("created_at").order("id").range(a, b)
    ),
  ]);

  const paths: string[] = [];
  const collect = (rows: Row[], ...cols: string[]) => {
    for (const r of rows) {
      for (const c of cols) if (typeof r[c] === "string") paths.push(r[c] as string);
    }
  };
  collect(avatars, "glb_path");
  collect(garments, "image_path", "glb_path", "sewing_pattern_path");
  collect(outfits, "preview_path");
  collect(drapeCache, "glb_path");
  const signed = await signPaths(admin, uid, paths);

  const exportedAt = new Date();
  const body = {
    format: DATA_EXPORT_FORMAT,
    contracts_version: CONTRACTS_VERSION,
    exported_at: exportedAt.toISOString(),
    signed_urls_expire_at: new Date(exportedAt.getTime() + DATA_EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    original_photos_retained: false,
    notes: NOTES,
    account: { id: uid, email: user.email, created_at: user.created_at },
    profile,
    consents,
    avatars: avatars.map((r) => withUrl(r, "glb", signed)),
    color_profiles: colorProfiles,
    garments: garments.map((r) =>
      withUrl(withUrl(withUrl(r, "image", signed), "glb", signed), "sewing_pattern", signed)
    ),
    fit_results: fitResults,
    user_fit_preferences: preferences,
    outfits: outfits.map((r) => withUrl(r, "preview", signed)),
    drape_cache: drapeCache.map((r) => withUrl(r, "glb", signed)),
    garment_embeddings: embeddings.flatMap((g): DataExportGarmentEmbedding[] => {
      const vector = parseVector(g.embedding);
      return vector && typeof g.embedding_model === "string"
        ? [{ garment_id: g.id as string, model: g.embedding_model, vector }]
        : [];
    }),
    jobs: jobs.map((j): DataExportJob => ({
      ...(j as unknown as DataExportJob),
      input: stripPaths(j.input),
      output: (j.output ?? null) as JobResult | null,
    })),
  };

  const checked = validate.dataExport(body);
  if (!checked.ok) {
    // Solo rutas del esquema, nunca valores: el cuerpo lleva datos personales.
    console.error("data export does not match the contract", JSON.stringify(checked.errors.map((e) => e.path)));
    throw new HttpError(500, "internal", "data export failed contract validation");
  }
  const result: DataExport = checked.value;

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="probador-datos-${result.exported_at.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}));
