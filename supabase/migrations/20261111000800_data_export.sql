-- =============================================================================
-- Probador virtual 3D · 0008 · Exportación de datos (D7): cuota
--
-- La Edge Function export-data (GET, arts. 15 y 20 RGPD) registra cada
-- exportación aquí y rechaza la petición (429 quota_exceeded) si el usuario
-- ya hizo DATA_EXPORT_DAILY_QUOTA (5) en las últimas 24 h. Cada exportación
-- firma URLs a todos sus GLB y patrones: la cuota acota el coste y el abuso de
-- un token robado. Solo se guarda cuándo se exportó, nada del contenido.
-- =============================================================================

create table public.data_export_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index data_export_requests_user_created_idx on public.data_export_requests (user_id, created_at desc);
comment on table public.data_export_requests is
  'Cuándo pidió cada usuario una exportación de datos (cuota de export-data). Solo service_role; se purga a los 30 días.';

-- Interna de la API: sin políticas = invisible para anon/authenticated.
alter table public.data_export_requests enable row level security;
revoke all on table public.data_export_requests from public, anon, authenticated;

-- Registra una exportación si cabe en la cuota; false si no. Serializa por
-- usuario para que dos peticiones simultáneas no superen el límite.
create or replace function public.register_data_export(p_user_id uuid, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('data_export:' || p_user_id::text, 0));
  if (select count(*) from public.data_export_requests
       where user_id = p_user_id and created_at > now() - interval '24 hours') >= p_daily_limit then
    return false;
  end if;
  insert into public.data_export_requests (user_id) values (p_user_id);
  return true;
end;
$$;

create or replace function public.purge_data_export_requests(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.data_export_requests where created_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.register_data_export(uuid, integer) from public, anon, authenticated;
revoke all on function public.purge_data_export_requests(interval) from public, anon, authenticated;
grant execute on function public.register_data_export(uuid, integer) to service_role;
grant execute on function public.purge_data_export_requests(interval) to service_role;

select cron.schedule('data-export-requests-purge', '53 3 * * *', $$ select public.purge_data_export_requests(); $$);
