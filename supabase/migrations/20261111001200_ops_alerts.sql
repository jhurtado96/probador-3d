-- =============================================================================
-- Probador virtual 3D · 0012 · Alertas de privacidad consultables (revisión de la fase 0: M6)
--
-- La red de seguridad de 60 minutos dependía de una llamada HTTP (pg_net →
-- Edge Function maintenance) que podía fallar en silencio. Ahora:
--   * `ops_alerts` registra cada incidencia abierta (una fila por tipo mientras
--     dura; se cierra sola cuando la condición desaparece). Solo service_role la
--     lee; ningún dato personal: recuentos y códigos.
--   * `privacy-watchdog` (pg_cron, cada 5 minutos, SQL puro sin HTTP) comprueba:
--       raw_uploads_overdue        fotos en raw-uploads con más de 75 minutos
--       maintenance_not_configured faltan los secretos de Vault de maintenance
--       maintenance_http_failed    las llamadas a maintenance de los últimos
--                                  15 minutos no devolvieron 2xx
--   * invoke_maintenance ya no emite solo un WARNING: abre la alerta.
--   * Si hay una alerta `raw_uploads_overdue` abierta, create-job rechaza los
--     jobs con fotos (503 `scans_paused`), como pide docs/architecture.md §6.
--   * Si existe el secreto de Vault `ops_alert_webhook_url`, cada alerta nueva
--     se envía además por pg_net a ese webhook (canal a elegir por el usuario).
-- =============================================================================

create table public.ops_alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('raw_uploads_overdue', 'maintenance_not_configured',
                                            'maintenance_http_failed')),
  details     jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  opened_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences >= 1),
  resolved_at timestamptz
);
create unique index ops_alerts_one_open_per_kind on public.ops_alerts (kind) where resolved_at is null;
comment on table public.ops_alerts is
  'Incidencias operativas de privacidad (M6): una fila abierta por tipo; se cierra sola al desaparecer la condición. '
  'Sin datos personales. Consulta: select * from public.ops_alerts where resolved_at is null.';

alter table public.ops_alerts enable row level security;
revoke all on table public.ops_alerts from public, anon, authenticated, service_role;
grant select on table public.ops_alerts to service_role;

-- Abre (o mantiene) la alerta de un tipo; avisa al webhook solo al abrirla.
create or replace function private.raise_ops_alert(p_kind text, p_details jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean := false;
  v_url text;
begin
  update public.ops_alerts
     set last_seen_at = now(), occurrences = occurrences + 1, details = p_details
   where kind = p_kind and resolved_at is null;
  if not found then
    insert into public.ops_alerts (kind, details) values (p_kind, p_details);
    v_new := true;
  end if;
  if v_new then
    raise warning 'ops alert opened: %', p_kind;
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ops_alert_webhook_url';
    if v_url is not null then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('alert', p_kind, 'details', p_details, 'opened_at', now()),
        timeout_milliseconds := 10000);
    end if;
  end if;
end;
$$;

create or replace function private.resolve_ops_alert(p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ops_alerts set resolved_at = now() where kind = p_kind and resolved_at is null;
$$;

-- Sustituye a la de 0006: sin secretos abre una alerta en lugar de solo avisar en el log.
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
      'x-maintenance-secret', v_secret),
    body := jsonb_build_object('tasks', to_jsonb(p_tasks)),
    timeout_milliseconds := 55000
  );
end;
$$;

-- Comprobación periódica, sin HTTP. Devuelve el estado para poder consultarlo a mano.
create or replace function public.check_privacy_invariants()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_overdue   integer;
  v_oldest    timestamptz;
  v_configured boolean;
  v_failed    integer := 0;
  v_calls     integer := 0;
begin
  select count(*), min(o.created_at) into v_overdue, v_oldest
    from storage.objects o
   where o.bucket_id = 'raw-uploads' and o.created_at < now() - interval '75 minutes';
  if v_overdue > 0 then
    perform private.raise_ops_alert('raw_uploads_overdue',
      jsonb_build_object('objects', v_overdue, 'oldest_minutes', floor(extract(epoch from now() - v_oldest) / 60)));
  else
    perform private.resolve_ops_alert('raw_uploads_overdue');
  end if;

  v_configured := (select count(*) = 2 from vault.decrypted_secrets
                    where name in ('project_url', 'maintenance_secret'));
  if v_configured then
    perform private.resolve_ops_alert('maintenance_not_configured');
  else
    perform private.raise_ops_alert('maintenance_not_configured', '{}');
  end if;

  -- Respuestas de pg_net de los últimos 15 minutos (pg_net las guarda unas horas).
  if to_regclass('net._http_response') is not null then
    execute $q$
      select count(*) filter (where status_code is null or status_code not between 200 and 299 or timed_out),
             count(*)
        from net._http_response where created > now() - interval '15 minutes'
    $q$ into v_failed, v_calls;
  end if;
  if v_calls > 0 and v_failed = v_calls then
    perform private.raise_ops_alert('maintenance_http_failed', jsonb_build_object('failed_calls', v_failed));
  elsif v_calls > 0 then
    perform private.resolve_ops_alert('maintenance_http_failed');
  end if;

  return jsonb_build_object('raw_uploads_overdue', v_overdue, 'maintenance_configured', v_configured,
                            'maintenance_calls_15m', v_calls, 'maintenance_failed_15m', v_failed);
end;
$$;

-- ¿Se aceptan fotos nuevas? No mientras haya fotos que superan el plazo de borrado.
create or replace function public.scans_paused()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ops_alerts where kind = 'raw_uploads_overdue' and resolved_at is null);
$$;

revoke all on function private.raise_ops_alert(text, jsonb) from public, anon, authenticated;
revoke all on function private.resolve_ops_alert(text) from public, anon, authenticated;
revoke all on function private.invoke_maintenance(text[]) from public, anon, authenticated;
revoke all on function public.check_privacy_invariants() from public, anon, authenticated;
revoke all on function public.scans_paused() from public, anon, authenticated;
grant execute on function public.check_privacy_invariants() to service_role;
grant execute on function public.scans_paused() to service_role;

select cron.schedule('privacy-watchdog', '*/5 * * * *', $$ select public.check_privacy_invariants(); $$);
