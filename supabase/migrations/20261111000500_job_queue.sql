-- =============================================================================
-- Probador virtual 3D · 0005 · Cola de jobs, persistencia de resultados,
-- retirada de consentimientos y funciones de mantenimiento
--
-- Todas las funciones `public.*` de este fichero son SECURITY DEFINER y solo
-- las puede ejecutar service_role (las Edge Functions). La app no las ve.
-- =============================================================================

-- Intentos máximos por job (docs/architecture.md §3.2).
create or replace function private.max_job_attempts()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- Plazo de un intento según el tipo de job.
create or replace function private.job_timeout(p_type public.job_type)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'avatar'  then interval '10 minutes'
    when 'garment' then interval '10 minutes'
    when 'drape'   then interval '10 minutes'
    when 'color'   then interval '5 minutes'
  end
$$;

-- `storage://assets/…` → `assets/…`, solo si la ruta está entre las que la API
-- autorizó al worker en este intento (evita que un worker apunte a ficheros de
-- otro usuario).
create or replace function private.storage_ref_to_path(p_ref text, p_allowed text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_path text;
begin
  if p_ref is null then
    return null;
  end if;
  if p_ref not like 'storage://%' then
    raise exception 'artifact url must be storage://<path>, got %', left(p_ref, 40)
      using errcode = '22023';
  end if;
  v_path := substr(p_ref, length('storage://') + 1);
  if not (v_path = any (coalesce(p_allowed, '{}'))) then
    raise exception 'artifact path % was not issued to this job', v_path using errcode = '22023';
  end if;
  return v_path;
end;
$$;

-- jsonb `null` → SQL NULL.
create or replace function private.jsonb_nullif(p jsonb)
returns jsonb language sql immutable set search_path = ''
as $$ select case when p is null or jsonb_typeof(p) = 'null' then null else p end $$;

-- =============================================================================
-- Despacho
-- =============================================================================

-- Reserva jobs `queued` listos para despachar (todas sus fotos ya subidas) y
-- consume un intento. Con p_job_id reserva solo ese job.
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
           output_paths = '{}'
      from bumped b
     where r.job_id = b.id
    returning r.job_id, r.input_paths, r.cache_key
  )
  select b.id, b.user_id, b.type, b.input, b.attempts, runs.input_paths, runs.cache_key
    from bumped b join runs on runs.job_id = b.id;
end;
$$;

-- Rutas de salida autorizadas para el intento en curso (antes del POST al worker).
create or replace function public.set_job_output_paths(p_job_id uuid, p_attempt integer, p_output_paths text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.job_runs r
     set output_paths = p_output_paths
    from public.jobs j
   where r.job_id = p_job_id and j.id = r.job_id and j.attempts = p_attempt;
$$;

-- El POST al worker falló: el intento cuenta, pero el job vuelve a estar
-- disponible para el siguiente pase de pg_cron.
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
         last_dispatch_error = left(p_error, 500)
    from public.jobs j
   where r.job_id = p_job_id and j.id = r.job_id and j.attempts = p_attempt and j.status = 'queued';
$$;

-- =============================================================================
-- Callback: persistir el resultado de un job en una sola transacción
-- =============================================================================
-- Devuelve {"result": "applied" | "stale_attempt" | "already_terminal", "type": …}
-- Lanza P0002 si el job no existe y 22023 si la salida no es coherente con el job.
-- La Edge Function ya validó p_output / p_error contra el JSON Schema del contrato
-- y ya borró las fotos de entrada (p_input_deleted_at) si el estado es terminal.
create or replace function public.complete_job(
  p_job_id           uuid,
  p_attempt          integer,
  p_status           text,
  p_progress         numeric default null,
  p_stage            text default null,
  p_output           jsonb default null,
  p_error            jsonb default null,
  p_worker_version   text default null,
  p_input_deleted_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j        public.jobs%rowtype;
  r        public.job_runs%rowtype;
  v        jsonb;
  g        public.garments%rowtype;
  c        text[];
  gid      uuid;
  fr       jsonb;
  frid     uuid;
  v_shape  text;
  v_output jsonb;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % not found', p_job_id using errcode = 'P0002';
  end if;
  select * into r from public.job_runs where job_id = p_job_id for update;

  if j.status in ('succeeded', 'failed', 'canceled') then
    return jsonb_build_object('result', 'already_terminal', 'type', j.type, 'status', j.status);
  end if;
  if p_attempt is distinct from j.attempts then
    return jsonb_build_object('result', 'stale_attempt', 'type', j.type, 'status', j.status);
  end if;

  -- Progreso --------------------------------------------------------------------
  if p_status = 'running' then
    update public.jobs
       set status = 'running',
           started_at = coalesce(started_at, now()),
           progress = coalesce(p_progress, progress),
           stage = coalesce(p_stage, stage),
           worker_version = coalesce(p_worker_version, worker_version)
     where id = p_job_id;
    return jsonb_build_object('result', 'applied', 'type', j.type, 'status', 'running');
  end if;

  -- Fallo -------------------------------------------------------------------------
  if p_status = 'failed' then
    update public.jobs
       set status = 'failed', error = p_error, output = null, finished_at = now(),
           worker_version = coalesce(p_worker_version, worker_version)
     where id = p_job_id;
    update public.job_runs set input_deleted_at = p_input_deleted_at where job_id = p_job_id;
    if j.type = 'garment' then
      update public.garments set status = 'failed'
       where id = (j.input ->> 'garment_id')::uuid and status = 'processing';
    end if;
    return jsonb_build_object('result', 'applied', 'type', j.type, 'status', 'failed');
  end if;

  if p_status <> 'succeeded' then
    raise exception 'invalid callback status %', p_status using errcode = '22023';
  end if;
  if p_output is null then
    raise exception 'succeeded callback without output' using errcode = '22023';
  end if;

  v_output := p_output;

  -- Éxito: avatar -------------------------------------------------------------------
  if j.type = 'avatar' then
    v := p_output -> 'avatar';
    if (v ->> 'user_id')::uuid is distinct from j.user_id then
      raise exception 'avatar.user_id does not match job owner' using errcode = '22023';
    end if;
    insert into public.avatars (
      id, user_id, body_model, model_version, smplx, measurements, measurements_source,
      measurements_override, glb_path, pose, shape_hash, confidence)
    values (
      (v ->> 'id')::uuid, j.user_id, (v ->> 'body_model')::public.body_model, v ->> 'model_version',
      v -> 'smplx', v -> 'measurements', (v ->> 'measurements_source')::public.measurement_source,
      private.jsonb_nullif(v -> 'measurements_override'),
      private.storage_ref_to_path(v ->> 'glb_url', r.output_paths),
      (v ->> 'pose')::public.avatar_pose, v ->> 'shape_hash', (v ->> 'confidence')::numeric)
    on conflict (id) do nothing;
    v_output := jsonb_set(v_output, '{input_deleted_at}', to_jsonb(p_input_deleted_at));

  -- Éxito: colorimetría ---------------------------------------------------------------
  elsif j.type = 'color' then
    v := p_output -> 'color_profile';
    if (v ->> 'user_id')::uuid is distinct from j.user_id then
      raise exception 'color_profile.user_id does not match job owner' using errcode = '22023';
    end if;
    insert into public.color_profiles (
      id, user_id, season, undertone, value, intensity, contrast, scores, skin_lab, hair_lab,
      eye_lab, palettes, metal, confidence, alternatives, white_balanced, user_overridden,
      pipeline_version)
    values (
      (v ->> 'id')::uuid, j.user_id, (v ->> 'season')::public.color_season,
      (v ->> 'undertone')::public.undertone, (v ->> 'value')::public.color_value,
      (v ->> 'intensity')::public.color_intensity, (v ->> 'contrast')::public.contrast_level,
      v -> 'scores', v -> 'skin_lab', private.jsonb_nullif(v -> 'hair_lab'),
      private.jsonb_nullif(v -> 'eye_lab'), v -> 'palettes', (v ->> 'metal')::public.metal,
      (v ->> 'confidence')::numeric, private.jsonb_nullif(v -> 'alternatives'),
      (v ->> 'white_balanced')::boolean, false, v ->> 'pipeline_version')
    on conflict (id) do nothing;
    v_output := jsonb_set(v_output, '{input_deleted_at}', to_jsonb(p_input_deleted_at));

  -- Éxito: prenda (respeta user_corrected_fields) ------------------------------------
  elsif j.type = 'garment' then
    v := p_output -> 'garment';
    gid := (j.input ->> 'garment_id')::uuid;
    if (v ->> 'id')::uuid is distinct from gid then
      raise exception 'garment.id does not match job input' using errcode = '22023';
    end if;
    select * into g from public.garments where id = gid for update;
    if found then
      if g.user_id is distinct from j.user_id then
        raise exception 'garment owner does not match job owner' using errcode = '22023';
      end if;
      c := g.user_corrected_fields;
      update public.garments set
        status           = 'ready',
        category         = case when 'category' = any (c) and g.category is not null then g.category
                                else (v ->> 'category')::public.garment_category end,
        name             = case when 'name' = any (c) then g.name else coalesce(v ->> 'name', g.name) end,
        brand            = case when 'brand' = any (c) then g.brand else coalesce(v ->> 'brand', g.brand) end,
        attributes       = case when 'attributes' = any (c) then g.attributes else v -> 'attributes' end,
        colors           = case when 'colors' = any (c) then g.colors else v -> 'colors' end,
        design_fit       = case when 'design_fit' = any (c) and g.design_fit is not null then g.design_fit
                                else (v ->> 'design_fit')::public.design_fit end,
        size_label       = case when 'size_label' = any (c) then g.size_label else v ->> 'size_label' end,
        level            = (v ->> 'level')::smallint,
        template_id      = v ->> 'template_id',
        image_path       = private.storage_ref_to_path(v ->> 'image_url', r.output_paths),
        glb_path         = private.storage_ref_to_path(v ->> 'glb_url', r.output_paths),
        pipeline_version = v ->> 'pipeline_version'
      where id = gid;

      if not ('measurements' = any (c)) then
        insert into public.garment_measurements (garment_id, size_label, zones, source)
        select gid, m ->> 'size_label', m -> 'zones', (m ->> 'source')::public.garment_measurement_source
          from jsonb_array_elements(coalesce(v -> 'measurements', '[]')) as m
        on conflict (garment_id, size_label) do update
          set zones = excluded.zones, source = excluded.source;
      end if;
    end if;  -- si el usuario borró la prenda mientras tanto, solo se cierra el job
    v_output := jsonb_set(v_output, '{input_deleted_at}', to_jsonb(p_input_deleted_at));

  -- Éxito: drapeado -------------------------------------------------------------------
  elsif j.type = 'drape' then
    if p_output ->> 'cache_key' is distinct from r.cache_key then
      raise exception 'cache_key does not match the one issued for this job' using errcode = '22023';
    end if;
    v_output := jsonb_set(v_output, '{cache_hit}', 'false');
    select a.shape_hash into v_shape
      from public.avatars a where a.id = (j.input ->> 'avatar_id')::uuid and a.user_id = j.user_id;
    if found and exists (select 1 from public.garments where id = (j.input ->> 'garment_id')::uuid) then
      fr := private.jsonb_nullif(p_output -> 'fit_result');
      if fr is not null then
        if fr ->> 'avatar_id' is distinct from j.input ->> 'avatar_id'
           or fr ->> 'garment_id' is distinct from j.input ->> 'garment_id' then
          raise exception 'fit_result does not match job input' using errcode = '22023';
        end if;
        insert into public.fit_results (
          id, avatar_id, garment_id, size_label, zones, verdict, effective_fit,
          matches_design_fit, score, recommended_size_label, method, confidence)
        values (
          (fr ->> 'id')::uuid, (fr ->> 'avatar_id')::uuid, (fr ->> 'garment_id')::uuid,
          fr ->> 'size_label', fr -> 'zones', (fr ->> 'verdict')::public.fit_verdict,
          (fr ->> 'effective_fit')::public.design_fit, (fr ->> 'matches_design_fit')::boolean,
          (fr ->> 'score')::numeric, fr ->> 'recommended_size_label',
          (fr ->> 'method')::public.fit_method, (fr ->> 'confidence')::numeric)
        on conflict (id) do nothing;
        frid := (fr ->> 'id')::uuid;
      end if;
      insert into public.drape_cache (
        user_id, cache_key, avatar_id, garment_id, size_label, pose, quality, shape_hash,
        simulator_version, glb_path, fit_result_id)
      values (
        j.user_id, r.cache_key, (j.input ->> 'avatar_id')::uuid, (j.input ->> 'garment_id')::uuid,
        j.input ->> 'size_label', (j.input ->> 'pose')::public.avatar_pose,
        (j.input ->> 'quality')::public.drape_quality, v_shape,
        coalesce(p_worker_version, 'unknown'),
        private.storage_ref_to_path(p_output ->> 'glb_url', r.output_paths), frid)
      on conflict (user_id, cache_key) do update
        set glb_path = excluded.glb_path,
            fit_result_id = coalesce(excluded.fit_result_id, public.drape_cache.fit_result_id),
            simulator_version = excluded.simulator_version,
            last_used_at = now();
    end if;  -- avatar o prenda borrados mientras tanto: no se cachea
  end if;

  update public.jobs
     set status = 'succeeded', progress = 1, output = v_output, error = null,
         started_at = coalesce(started_at, now()), finished_at = now(),
         worker_version = coalesce(p_worker_version, worker_version)
   where id = p_job_id;
  update public.job_runs set input_deleted_at = p_input_deleted_at where job_id = p_job_id;

  return jsonb_build_object('result', 'applied', 'type', j.type, 'status', 'succeeded');
end;
$$;

-- =============================================================================
-- Reintentos y plazos (pg_cron, cada minuto)
-- =============================================================================
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
  v_failed_garments uuid[];
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
       set dispatched_at = null, deadline_at = null, output_paths = '{}'
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

-- =============================================================================
-- Borrado de fotos y limpieza de Storage (los usa la Edge Function maintenance)
-- =============================================================================

-- Jobs ya terminados cuyas fotos de entrada aún no constan como borradas
-- (fallidos por timeout, cancelados, callback que no pudo borrar…).
create or replace function public.jobs_with_pending_input_deletion(p_limit integer default 100)
returns table (job_id uuid, input_paths text[])
language sql
stable
security definer
set search_path = ''
as $$
  select r.job_id, r.input_paths
    from public.job_runs r join public.jobs j on j.id = r.job_id
   where j.status in ('succeeded', 'failed', 'canceled')
     and r.input_deleted_at is null
     and cardinality(r.input_paths) > 0
   order by j.finished_at
   limit p_limit;
$$;

create or replace function public.mark_job_inputs_deleted(p_job_ids uuid[], p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.job_runs set input_deleted_at = p_at
   where job_id = any (p_job_ids) and input_deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Red de seguridad RGPD: objetos de raw-uploads con más de p_max_age.
create or replace function public.expired_raw_uploads(
  p_max_age interval default interval '60 minutes',
  p_limit integer default 1000)
returns table (name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, o.created_at
    from storage.objects o
   where o.bucket_id = 'raw-uploads'
     and o.created_at < now() - p_max_age
   order by o.created_at
   limit p_limit;
$$;

-- Objetos de assets que ya no referencia ninguna fila (avatar borrado,
-- consentimiento retirado, caché purgada…). No toca catalog/.
create or replace function public.orphaned_assets(
  p_min_age interval default interval '1 day',
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
                      where g.glb_path = 'assets/' || o.name or g.image_path = 'assets/' || o.name)
     and not exists (select 1 from public.drape_cache d where d.glb_path = 'assets/' || o.name)
     and not exists (select 1 from public.outfits f where f.preview_path = 'assets/' || o.name)
     and not exists (select 1 from public.job_runs r join public.jobs j on j.id = r.job_id
                      where j.status in ('queued', 'running')
                        and ('assets/' || o.name) = any (r.output_paths))
   limit p_limit;
$$;

-- Caché de drapeado sin uso en 90 días (docs/architecture.md §3.3). Los GLB
-- quedan huérfanos y los borra orphaned_assets en el siguiente pase.
create or replace function public.purge_drape_cache(p_unused_for interval default interval '90 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.drape_cache where last_used_at < now() - p_unused_for;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Todos los objetos de Storage de un usuario (borrado de cuenta).
create or replace function public.user_storage_objects(p_user_id uuid)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where (o.bucket_id in ('raw-uploads', 'assets') and (storage.foldername(o.name))[1] = p_user_id::text)
      or o.owner_id = p_user_id::text;
$$;

-- =============================================================================
-- Retirada de consentimiento: borra los datos derivados de ese tratamiento
-- =============================================================================
create or replace function private.on_consent_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ¿Queda otro consentimiento vigente del mismo tratamiento? Entonces no se borra nada.
  if exists (select 1 from public.consents c
              where c.user_id = new.user_id and c.purpose = new.purpose
                and c.withdrawn_at is null and c.id <> new.id) then
    return new;
  end if;

  if new.purpose = 'body_scan' then
    -- Avatares obtenidos de fotos (los manuales no dependen del consentimiento).
    -- En cascada: fit_results y drape_cache. Los GLB los limpia orphaned_assets.
    delete from public.avatars where user_id = new.user_id and measurements_source <> 'manual';
    update public.jobs set status = 'canceled', finished_at = now()
     where user_id = new.user_id and type = 'avatar' and status in ('queued', 'running');
  elsif new.purpose = 'color_analysis' then
    delete from public.color_profiles where user_id = new.user_id and not user_overridden;
    update public.jobs set status = 'canceled', finished_at = now()
     where user_id = new.user_id and type = 'color' and status in ('queued', 'running');
  elsif new.purpose = 'personalization' then
    -- Recomendaciones generadas para el usuario.
    delete from public.outfits where user_id = new.user_id and source <> 'user';
  end if;
  -- analytics: no hay datos de analítica en esta base de datos.
  return new;
end;
$$;

create trigger consents_on_withdrawn
  after update of withdrawn_at on public.consents
  for each row
  when (old.withdrawn_at is null and new.withdrawn_at is not null)
  execute function private.on_consent_withdrawn();

-- =============================================================================
-- Permisos: solo service_role ejecuta estas funciones
-- =============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_jobs_for_dispatch(uuid, integer)',
    'public.set_job_output_paths(uuid, integer, text[])',
    'public.release_job_dispatch(uuid, integer, text)',
    'public.complete_job(uuid, integer, text, numeric, text, jsonb, jsonb, text, timestamptz)',
    'public.reap_stale_jobs()',
    'public.jobs_with_pending_input_deletion(integer)',
    'public.mark_job_inputs_deleted(uuid[], timestamptz)',
    'public.expired_raw_uploads(interval, integer)',
    'public.orphaned_assets(interval, integer)',
    'public.purge_drape_cache(interval)',
    'public.user_storage_objects(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
