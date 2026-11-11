-- =============================================================================
-- Probador virtual 3D · 0013 · Despacho sin datos personales en la cola de GPU,
-- cuota atómica, caché de drapeado coherente y validación de lo que escribe la app
-- (revisión de la fase 0: A3, B4, B8, M4, B2, B6)
--
-- A3. La API ya no envía el JobDispatch al proveedor de GPU. Envía un aviso con
--     job_id, tipo e intento (JobDispatchNotice); el contenedor pide el despacho
--     completo a la Edge Function job-dispatch con una petición firmada.
--     `claim_job_dispatch_fetch` lo entrega UNA vez por intento y solo dentro del
--     plazo: un aviso reenviado (B4) no vuelve a descargar la foto.
-- B8. `enqueue_job` cuenta la cuota e inserta el job en una transacción con
--     bloqueo por usuario.
-- M4. Corregir `measurements_override` invalida la caché de drapeado del
--     avatar (la clave de caché incluye además las medidas efectivas).
-- B2. La app ya no escribe `garments.status`; `measurements_override` solo
--     admite claves de BodyMeasurements con números en rangos plausibles.
-- B6. Longitud máxima de `garments.size_label` (32) y `garments.brand` (80).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A3: entrega única del despacho por intento
-- -----------------------------------------------------------------------------
alter table public.job_runs add column dispatch_fetched_at timestamptz;
comment on column public.job_runs.dispatch_fetched_at is
  'Cuándo pidió el worker el JobDispatch de este intento (job-dispatch). Solo se entrega una vez por intento.';

create or replace function public.claim_jobs_for_dispatch(p_job_id uuid default null, p_limit integer default 20)
returns table (id uuid, user_id uuid, type public.job_type, input jsonb, attempt integer, input_paths text[], cache_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select j.id
      from public.jobs j
      join public.job_runs r on r.job_id = j.id
     where j.status = 'queued'
       and r.dispatched_at is null
       and j.attempts < private.max_job_attempts()
       and (p_job_id is null or j.id = p_job_id)
       -- todas las entradas existen en raw-uploads
       and not exists (
         select 1 from unnest(r.input_paths) as p(path)
          where not exists (
            select 1 from storage.objects o
             where o.bucket_id = 'raw-uploads'
               and o.name = substr(p.path, length('raw-uploads/') + 1)))
     order by j.created_at
     limit p_limit
     for update of j skip locked
  ),
  bumped as (
    update public.jobs j
       set attempts = j.attempts + 1
      from candidates c
     where j.id = c.id
    returning j.id, j.user_id, j.type, j.input, j.attempts
  ),
  runs as (
    update public.job_runs r
       set dispatched_at = now(),
           deadline_at = now() + private.job_timeout(b.type),
           last_dispatch_error = null,
           output_paths = '{}',
           dispatch_fetched_at = null
      from bumped b
     where r.job_id = b.id
    returning r.job_id, r.input_paths, r.cache_key
  )
  select b.id, b.user_id, b.type, b.input, b.attempts, runs.input_paths, runs.cache_key
    from bumped b join runs on runs.job_id = b.id;
end;
$$;

create or replace function public.release_job_dispatch(p_job_id uuid, p_attempt integer, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_runs r
     set dispatched_at = null,
         deadline_at = null,
         output_paths = '{}',
         dispatch_fetched_at = null,
         last_dispatch_error = left(p_error, 500)
    from public.jobs j
   where r.job_id = p_job_id and j.id = r.job_id and j.attempts = p_attempt and j.status = 'queued';
$$;

create or replace function public.reap_stale_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requeued integer := 0;
  v_timed_out integer := 0;
  v_abandoned integer := 0;
begin
  -- 1. Intentos que superaron su plazo y aún tienen reintentos: vuelven a la cola.
  with stale as (
    select j.id from public.jobs j join public.job_runs r on r.job_id = j.id
     where j.status in ('queued', 'running') and r.deadline_at < now()
       and j.attempts < private.max_job_attempts()
     for update of j skip locked
  ), upd as (
    update public.jobs j
       set status = 'queued', progress = 0, stage = null, started_at = null
      from stale where j.id = stale.id
    returning j.id
  ), upd_runs as (
    update public.job_runs r
       set dispatched_at = null, deadline_at = null, output_paths = '{}', dispatch_fetched_at = null
      from upd where r.job_id = upd.id
    returning r.job_id
  )
  select count(*) into v_requeued from upd_runs;

  -- 2. Sin reintentos: fallo por timeout.
  with stale as (
    select j.id from public.jobs j join public.job_runs r on r.job_id = j.id
     where j.status in ('queued', 'running') and r.deadline_at < now()
       and j.attempts >= private.max_job_attempts()
     for update of j skip locked
  )
  update public.jobs j
     set status = 'failed', finished_at = now(), output = null,
         error = jsonb_build_object('code', 'timeout',
                                    'message', 'job exceeded its deadline on the last attempt',
                                    'retryable', true)
    from stale where j.id = stale.id;
  get diagnostics v_timed_out = row_count;

  -- 3. En cola sin despachar: o se agotaron los intentos de despacho, o las
  --    fotos nunca llegaron (60 min, el mismo plazo que el barrido).
  with abandoned as (
    select j.id, j.attempts from public.jobs j join public.job_runs r on r.job_id = j.id
     where j.status = 'queued' and r.dispatched_at is null
       and (j.attempts >= private.max_job_attempts() or j.created_at < now() - interval '60 minutes')
     for update of j skip locked
  )
  update public.jobs j
     set status = 'failed', finished_at = now(), output = null,
         error = case when abandoned.attempts = 0
                   then jsonb_build_object('code', 'invalid_input',
                                           'message', 'input files were never uploaded',
                                           'retryable', false)
                   else jsonb_build_object('code', 'internal',
                                           'message', 'job could not be dispatched to a worker',
                                           'retryable', true) end
    from abandoned where j.id = abandoned.id;
  get diagnostics v_abandoned = row_count;

  -- Prendas cuyo job ha fallado.
  update public.garments g set status = 'failed'
    from public.jobs j
   where j.type = 'garment' and j.status = 'failed' and g.status = 'processing'
     and g.id = (j.input ->> 'garment_id')::uuid
     and j.finished_at > now() - interval '5 minutes';

  return jsonb_build_object('requeued', v_requeued, 'timed_out', v_timed_out, 'abandoned', v_abandoned);
end;
$$;

-- El worker pide el despacho del intento `p_attempt`. Devuelve la fila del job
-- (como claim_jobs_for_dispatch) si el intento es el vigente, está despachado,
-- dentro de plazo y aún no se había entregado; si no, nada.
create or replace function public.claim_job_dispatch_fetch(p_job_id uuid, p_attempt integer)
returns table (id uuid, user_id uuid, type public.job_type, input jsonb, attempt integer, input_paths text[], cache_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with target as (
    select j.id from public.jobs j join public.job_runs r on r.job_id = j.id
     where j.id = p_job_id and j.attempts = p_attempt
       and j.status in ('queued', 'running')
       and r.dispatched_at is not null and r.dispatch_fetched_at is null
       and r.deadline_at > now()
     for update of j, r
  ), marked as (
    update public.job_runs r set dispatch_fetched_at = now()
      from target where r.job_id = target.id
    returning r.job_id, r.input_paths, r.cache_key
  )
  select j.id, j.user_id, j.type, j.input, j.attempts, m.input_paths, m.cache_key
    from marked m join public.jobs j on j.id = m.job_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- B8: cuota e inserción atómicas
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_user_id uuid, p_type public.job_type, p_input jsonb, p_input_paths text[], p_cache_key text,
  p_daily_limit integer)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('job_quota:' || p_user_id::text, 0));
  if (select count(*) from public.jobs
       where user_id = p_user_id and created_at > now() - interval '24 hours') >= p_daily_limit then
    return;  -- cuota agotada: ninguna fila
  end if;
  insert into public.jobs (user_id, type, status, input) values (p_user_id, p_type, 'queued', p_input)
  returning * into v_job;
  insert into public.job_runs (job_id, input_paths, cache_key) values (v_job.id, coalesce(p_input_paths, '{}'), p_cache_key);
  return next v_job;
end;
$$;

-- -----------------------------------------------------------------------------
-- M4: corregir medidas invalida los drapeados del avatar
-- -----------------------------------------------------------------------------
create or replace function private.on_avatar_measurements_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.drape_cache where avatar_id = new.id;
  return new;
end;
$$;
create trigger avatars_invalidate_drape_cache
  after update of measurements_override on public.avatars
  for each row
  when (old.measurements_override is distinct from new.measurements_override)
  execute function private.on_avatar_measurements_changed();

-- -----------------------------------------------------------------------------
-- B2: validación de measurements_override y status fuera del alcance de la app
-- -----------------------------------------------------------------------------
create or replace function private.valid_measurements_override(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) as e(k, v)
       where e.k not in ('height_cm', 'chest_cm', 'waist_cm', 'hip_cm', 'shoulder_width_cm', 'arm_length_cm',
                         'inseam_cm', 'neck_cm', 'underbust_cm', 'bicep_cm', 'wrist_cm', 'thigh_cm', 'calf_cm',
                         'torso_length_cm', 'knee_cm', 'rise_cm', 'weight_kg')
          or jsonb_typeof(e.v) <> 'number'
          or (e.k = 'height_cm' and (e.v::numeric < 50 or e.v::numeric > 260))
          or (e.k = 'weight_kg' and (e.v::numeric < 20 or e.v::numeric > 350))
          or (e.k not in ('height_cm', 'weight_kg') and (e.v::numeric <= 0 or e.v::numeric > 300))));
$$;

alter table public.avatars
  add constraint avatars_measurements_override_valid
  check (private.valid_measurements_override(measurements_override));

revoke update on public.garments from authenticated;
grant update (category, name, brand, attributes, colors, design_fit, size_label, user_corrected_fields)
  on public.garments to authenticated;

-- B6
alter table public.garments
  add constraint garments_size_label_length check (size_label is null or char_length(size_label) <= 32),
  add constraint garments_brand_length check (brand is null or char_length(brand) <= 80);

revoke all on function public.claim_job_dispatch_fetch(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_job_dispatch_fetch(uuid, integer) to service_role;
revoke all on function public.enqueue_job(uuid, public.job_type, jsonb, text[], text, integer) from public, anon, authenticated;
grant execute on function public.enqueue_job(uuid, public.job_type, jsonb, text[], text, integer) to service_role;
revoke all on function private.on_avatar_measurements_changed() from public, anon, authenticated;
