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

  /** Secreto HMAC compartido con los workers para firmar los callbacks. */
  jobCallbackSecret: () => requireEnv("JOB_CALLBACK_SECRET"),
  /** URL pública de job-callback que se envía al worker (por defecto, la del proyecto). */
  jobCallbackUrl: () => optionalEnv("JOB_CALLBACK_URL") ?? `${requireEnv("SUPABASE_URL")}/functions/v1/job-callback`,

  /** Endpoint web de Modal (región UE) que recibe JobDispatch. Sin él no se despacha. */
  workerDispatchUrl: () => optionalEnv("WORKER_DISPATCH_URL"),
  /** Token Bearer que el endpoint del worker exige. */
  workerDispatchToken: () => optionalEnv("WORKER_DISPATCH_TOKEN"),

  /** Secreto con el que pg_cron llama a la función maintenance. */
  maintenanceSecret: () => requireEnv("MAINTENANCE_SECRET"),

  /** Jobs por usuario en 24 h (coste de GPU). */
  jobDailyQuota: () => Number(optionalEnv("JOB_DAILY_QUOTA") ?? "50"),
  /** Versión del simulador de tela; forma parte de la clave de caché del drapeado. */
  drapeSimulatorVersion: () => optionalEnv("DRAPE_SIMULATOR_VERSION") ?? "drape-sim-0",
};
