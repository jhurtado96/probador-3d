-- =============================================================================
-- Probador virtual 3D · 0006 · Tareas programadas (pg_cron)
--
--   jobs-reap             cada minuto  SQL: reintenta o da por fallidos los jobs colgados.
--   maintenance-minutely  cada minuto  HTTP → Edge Function `maintenance`:
--                                       despacha jobs en cola, borra las fotos de jobs
--                                       terminados y BARRE raw-uploads > 60 min.
--   maintenance-daily     03:17 UTC    SQL: purga drape_cache sin uso en 90 días;
--                                       HTTP: borra GLB huérfanos de assets.
--
-- Los ficheros solo se pueden borrar con la API de Storage, por eso el barrido
-- pasa por una Edge Function (pg_net). La URL y el secreto se leen de Vault:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<valor de MAINTENANCE_SECRET>', 'maintenance_secret');
--
-- Sin esos secretos la llamada no se hace y queda un aviso en el log de
-- Postgres; jobs-reap sigue funcionando.
-- =============================================================================

create or replace function private.invoke_maintenance(p_tasks text[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'maintenance_secret';
  if v_url is null or v_secret is null then
    raise warning 'maintenance not invoked: vault secrets project_url / maintenance_secret are missing';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-secret', v_secret),
    body := jsonb_build_object('tasks', to_jsonb(p_tasks)),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function private.invoke_maintenance(text[]) from public, anon, authenticated;

-- cron.schedule con nombre sustituye la tarea si ya existe (idempotente).
select cron.schedule('jobs-reap', '* * * * *', $$ select public.reap_stale_jobs(); $$);

select cron.schedule(
  'maintenance-minutely', '* * * * *',
  $$ select private.invoke_maintenance(array['dispatch', 'delete_job_inputs', 'sweep_raw_uploads']); $$);

select cron.schedule(
  'maintenance-daily', '17 3 * * *',
  $$ select public.purge_drape_cache(); select private.invoke_maintenance(array['gc_assets']); $$);
