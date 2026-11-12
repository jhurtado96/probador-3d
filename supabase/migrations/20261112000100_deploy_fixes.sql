-- =============================================================================
-- Probador virtual 3D · 0014 · Ajustes del primer despliegue en la nube (2026-11-12)
--
-- M3. Supabase ejecuta cada Edge Function en la región más cercana a quien la
--     llama, y quien llama puede elegir otra con la cabecera `x-region` o el
--     parámetro `forceFunctionRegion` (comprobado en el proyecto: la misma
--     llamada corrió en eu-west-3, eu-central-1 o us-east-1 según se pidiera).
--     pg_cron ya llama desde la base de datos (eu-west-3, París), pero se fija
--     la región de forma explícita para que no dependa del enrutado.
-- Advisor de rendimiento: dos claves foráneas sin índice que las cubra.
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
    perform private.raise_ops_alert('maintenance_not_configured', jsonb_build_object('tasks', to_jsonb(p_tasks)));
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-region', 'eu-west-3',  -- M3: región del proyecto (París); la ignora el stack local
      'x-maintenance-secret', v_secret),
    body := jsonb_build_object('tasks', to_jsonb(p_tasks)),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function private.invoke_maintenance(text[]) from public, anon, authenticated;

create index if not exists consents_purpose_text_version_idx on public.consents (purpose, text_version);
create index if not exists drape_cache_fit_result_idx on public.drape_cache (fit_result_id) where fit_result_id is not null;
