// Variables de entorno de las Edge Functions. Ver supabase/README.md.

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value ? value : undefined;
}

export const env = {
  /** Las inyecta Supabase en cada función. */
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  serviceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  anonKey: () => requireEnv("SUPABASE_ANON_KEY"),

  /** Secreto HMAC con el que los workers firman los callbacks (mismo nombre en el worker). */
  callbackSecret: () => requireEnv("PROBADOR_CALLBACK_SECRET"),
  /** Secreto HMAC con el que la API firma el despacho al worker (mismo nombre en el worker). */
  dispatchSecret: () => optionalEnv("PROBADOR_DISPATCH_SECRET"),
  /**
   * Acepta callbacks de workers en modo fake (JobCallback.fake). Solo para
   * desarrollo e integración: sin esta variable se rechazan.
   */
  allowFakeWorkers: () => optionalEnv("PROBADOR_ALLOW_FAKE_WORKERS") === "1",
  /** URL pública de job-callback que se envía al worker (por defecto, la del proyecto). */
  jobCallbackUrl: () => optionalEnv("JOB_CALLBACK_URL") ?? `${requireEnv("SUPABASE_URL")}/functions/v1/job-callback`,

  /**
   * URL pública de job-dispatch, donde el contenedor del worker pide el JobDispatch completo
   * (por defecto, la del proyecto). Va en el aviso de despacho (A3).
   */
  jobDispatchUrl: () => optionalEnv("JOB_DISPATCH_URL") ?? `${requireEnv("SUPABASE_URL")}/functions/v1/job-dispatch`,

  /** Endpoint web de Modal (región UE) que recibe el aviso de despacho (JobDispatchNotice). Sin él no se despacha. */
  workerDispatchUrl: () => optionalEnv("WORKER_DISPATCH_URL"),

  /** Secreto con el que pg_cron llama a la función maintenance. */
  maintenanceSecret: () => requireEnv("MAINTENANCE_SECRET"),

  /** Jobs por usuario en 24 h (coste de GPU). */
  jobDailyQuota: () => Number(optionalEnv("JOB_DAILY_QUOTA") ?? "50"),
  /** Exportaciones de datos (export-data) por usuario en 24 h. */
  dataExportDailyQuota: () => Number(optionalEnv("DATA_EXPORT_DAILY_QUOTA") ?? "5"),
  /** Versión del simulador de tela; forma parte de la clave de caché del drapeado. */
  drapeSimulatorVersion: () => optionalEnv("DRAPE_SIMULATOR_VERSION") ?? "drape-sim-0",
};
