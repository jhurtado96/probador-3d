-- =============================================================================
-- Probador virtual 3D · 0011 · Subidas pendientes revocables y GC más corto
-- (revisión de la fase 0: M2, B5)
--
-- Las URLs firmadas de subida de Supabase duran 2 h y no se pueden revocar
-- (D8). En lugar de esperar a que caduquen, Postgres decide si una subida cabe:
-- un trigger BEFORE INSERT en storage.objects solo admite
--   * en raw-uploads: una foto que es entrada de un job `queued` del dueño de la
--     carpeta (create-job la emitió y el job aún espera sus fotos);
--   * en assets: un artefacto que es salida autorizada del intento en curso de
--     un job `queued` o `running`; las miniaturas de `<uid>/outfits/` de un
--     usuario que existe; y `catalog/`.
-- Consecuencias:
--   * Darse de baja, retirar un consentimiento, borrar el avatar o la prenda, o
--     que el job termine o caduque cancela o cierra el job, y desde ese momento
--     cualquier URL de subida pendiente (de la app o del worker) falla: no
--     aparecen ficheros después de la baja ni de la retirada (M2).
--   * Una URL de raw-uploads ya no sirve para volver a subir cuando el callback
--     borró la foto (B5), porque el job ya no está en cola.
-- El trigger no se aplica a los INSERT directos por SQL de una sesión `postgres`
-- (migraciones y fixtures de tests, que no crean ficheros); los tests pgTAP lo
-- activan con `set local probador.storage_guard = 'on'`.
--
-- GC: orphaned_assets pasa de 1 día a 10 minutos (lo protegido son las salidas
-- autorizadas de jobs activos), corre cada 10 minutos y, además, en cuanto se
-- borra un avatar o una prenda (pg_net → maintenance).
-- =============================================================================

create or replace function private.guard_storage_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path   text := new.bucket_id || '/' || new.name;
  v_folder text[] := storage.foldername(new.name);
begin
  if session_user = 'postgres' and coalesce(current_setting('probador.storage_guard', true), '') <> 'on' then
    return new;
  end if;

  if new.bucket_id = 'raw-uploads' then
    if exists (select 1 from public.jobs j join public.job_runs r on r.job_id = j.id
                where j.status = 'queued' and j.user_id::text = v_folder[1]
                  and v_path = any (r.input_paths)) then
      return new;
    end if;
    raise exception 'upload rejected: % is not an input of a queued job', v_path using errcode = '42501';
  elsif new.bucket_id = 'assets' then
    if v_folder[1] = 'catalog' then
      return new;
    end if;
    if v_folder[2] = 'outfits' and exists (select 1 from public.profiles p where p.id::text = v_folder[1]) then
      return new;
    end if;
    if exists (select 1 from public.jobs j join public.job_runs r on r.job_id = j.id
                where j.status in ('queued', 'running') and v_path = any (r.output_paths)) then
      return new;
    end if;
    raise exception 'upload rejected: % is not an authorized output of an active job', v_path using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_storage_upload() from public, anon, authenticated;

create trigger objects_guard_upload
  before insert on storage.objects
  for each row execute function private.guard_storage_upload();

-- -----------------------------------------------------------------------------
-- Baja: cancelar antes de vaciar Storage (delete-account)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_user_jobs(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.jobs set status = 'canceled', finished_at = now()
   where user_id = p_user_id and status in ('queued', 'running');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.cancel_user_jobs(uuid) from public, anon, authenticated;
grant execute on function public.cancel_user_jobs(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- GC de assets: 10 minutos en lugar de 1 día
-- -----------------------------------------------------------------------------
create or replace function public.orphaned_assets(
  p_min_age interval default interval '10 minutes',
  p_limit integer default 1000)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'assets'
     and o.created_at < now() - p_min_age
     and (storage.foldername(o.name))[1] <> 'catalog'
     and not exists (select 1 from public.avatars a where a.glb_path = 'assets/' || o.name)
     and not exists (select 1 from public.garments g
                      where g.glb_path = 'assets/' || o.name or g.image_path = 'assets/' || o.name
                         or g.sewing_pattern_path = 'assets/' || o.name)
     and not exists (select 1 from public.drape_cache d where d.glb_path = 'assets/' || o.name)
     and not exists (select 1 from public.outfits f where f.preview_path = 'assets/' || o.name)
     and not exists (select 1 from public.job_runs r join public.jobs j on j.id = r.job_id
                      where j.status in ('queued', 'running')
                        and ('assets/' || o.name) = any (r.output_paths))
   limit p_limit;
$$;

-- Al borrar un avatar o una prenda (también por retirada de consentimiento), el
-- GC se lanza enseguida en lugar de esperar al siguiente pase.
create or replace function private.request_assets_gc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.invoke_maintenance(array['gc_assets']);
  return null;
end;
$$;
revoke all on function private.request_assets_gc() from public, anon, authenticated;

create trigger avatars_request_gc
  after delete on public.avatars
  for each statement execute function private.request_assets_gc();
create trigger garments_request_gc
  after delete on public.garments
  for each statement execute function private.request_assets_gc();

select cron.schedule('maintenance-gc', '*/10 * * * *', $$ select private.invoke_maintenance(array['gc_assets']); $$);
select cron.schedule(
  'maintenance-daily', '17 3 * * *',
  $$ select public.purge_drape_cache(); select public.purge_finished_jobs(); $$);
