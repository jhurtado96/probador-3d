-- =============================================================================
-- Probador virtual 3D · 0009 · Retención mínima en `jobs` (revisión de la fase 0: A1, A2, B9)
--
-- A1. `jobs.input` y `jobs.output` ya no guardan copias de datos personales:
--   * Al cerrar un job (succeeded, failed o canceled) un trigger reduce `input`
--     a sus identificadores (consent_id, avatar_id, garment_id: contrato
--     `RetainedJobInput`) y `output` a referencias (`JobResult`: avatar_id,
--     color_profile_id, garment_id, drape_cache_id, fit_result_id, cache_hit).
--     Altura, peso, género, rutas de fotos, medidas, forma, LAB e ITA solo
--     existen mientras el job está en cola o en curso. El trigger es la
--     garantía: vale para cualquier camino (complete_job, caché, cancelaciones,
--     reaper, SQL a mano).
--   * complete_job construye ya la salida como referencias.
--   * Retirar un consentimiento y borrar un avatar, un perfil de color o una
--     prenda llegan también a `jobs`: se cancelan los jobs en curso que dependen
--     de ello, se anula su `output` y se quita el id de su `input`.
--   * `maintenance-daily` purga los jobs terminados con más de 30 días
--     (contrato: JOB_RETENTION_DAYS), salvo los que aún tienen fotos por borrar.
--
-- A2. Retirar `color_analysis` borra TODOS los perfiles de color del usuario,
--     también los que corrigió a mano: la estación elegida va unida al LAB de
--     piel, pelo e iris y al ITA medidos en el selfie, y su única base legal es
--     el consentimiento (docs/architecture.md §7, D10).
--
-- B9. complete_job rechaza avatares `smplx` (sin licencia comercial firmada).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Minimización
-- -----------------------------------------------------------------------------

-- Lo que queda de `input` en un job terminado: solo identificadores.
create or replace function private.retained_job_input(p_type public.job_type, p_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(case p_type
    when 'avatar'  then jsonb_build_object('consent_id', p_input -> 'consent_id')
    when 'color'   then jsonb_build_object('consent_id', p_input -> 'consent_id')
    when 'garment' then jsonb_build_object('garment_id', p_input -> 'garment_id')
    when 'drape'   then jsonb_build_object('avatar_id', p_input -> 'avatar_id', 'garment_id', p_input -> 'garment_id')
  end)
$$;

-- Lo que puede quedar en `output`: referencias, nada más (lista blanca por tipo).
create or replace function private.job_result(p_type public.job_type, p_output jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_output is null or jsonb_typeof(p_output) <> 'object' then null
    when p_type = 'drape' then jsonb_build_object(
      'drape_cache_id', coalesce(p_output -> 'drape_cache_id', 'null'::jsonb),
      'fit_result_id',  coalesce(p_output -> 'fit_result_id', 'null'::jsonb),
      'cache_hit',      coalesce(p_output -> 'cache_hit', 'false'::jsonb))
    else nullif(jsonb_strip_nulls(case p_type
      when 'avatar'  then jsonb_build_object('avatar_id', p_output -> 'avatar_id')
      when 'color'   then jsonb_build_object('color_profile_id', p_output -> 'color_profile_id')
      when 'garment' then jsonb_build_object('garment_id', p_output -> 'garment_id')
    end), '{}'::jsonb)
  end
$$;

create or replace function private.minimize_finished_job()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('succeeded', 'failed', 'canceled') then
    new.input := private.retained_job_input(new.type, new.input);
    new.output := case when new.status = 'succeeded' then private.job_result(new.type, new.output) end;
  end if;
  return new;
end;
$$;

create trigger jobs_minimize_when_finished
  before insert or update on public.jobs
  for each row execute function private.minimize_finished_job();

comment on column public.jobs.input is
  'Entrada completa mientras el job está en cola o en curso; al terminar solo quedan sus ids (RetainedJobInput, A1).';
comment on column public.jobs.output is
  'Solo referencias a lo creado (JobResult): nunca medidas, forma, LAB ni ITA (A1).';

-- -----------------------------------------------------------------------------
-- complete_job: la salida que se guarda son referencias; B9 (smplx)
-- -----------------------------------------------------------------------------
create or replace function public.complete_job(
  p_job_id           uuid,
  p_attempt          integer,
  p_status           text,
  p_progress         numeric default null,
  p_stage            text default null,
  p_output           jsonb default null,
  p_error            jsonb default null,
  p_worker_version   text default null,
  p_input_deleted_at timestamptz default null,
  p_fake             boolean default false
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
  emb      jsonb;
  v_dc     uuid;
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
           worker_version = coalesce(p_worker_version, worker_version),
           fake = coalesce(p_fake, false)
     where id = p_job_id;
    return jsonb_build_object('result', 'applied', 'type', j.type, 'status', 'running');
  end if;

  -- Fallo -------------------------------------------------------------------------
  if p_status = 'failed' then
    update public.jobs
       set status = 'failed', error = p_error, output = null, finished_at = now(),
           worker_version = coalesce(p_worker_version, worker_version),
           fake = coalesce(p_fake, false),
           input_deleted_at = p_input_deleted_at
     where id = p_job_id;
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

  -- jobs.output solo guarda referencias (A1): v_output se construye por tipo.
  v_output := null;

  -- Éxito: avatar -------------------------------------------------------------------
  if j.type = 'avatar' then
    v := p_output -> 'avatar';
    if (v ->> 'user_id')::uuid is distinct from j.user_id then
      raise exception 'avatar.user_id does not match job owner' using errcode = '22023';
    end if;
    -- B9: SMPL-X no tiene licencia comercial firmada; no puede llegar a producción.
    if v ->> 'body_model' = 'smplx' then
      raise exception 'body_model smplx is not licensed for commercial use' using errcode = '22023';
    end if;
    insert into public.avatars (
      id, user_id, body_model, model_version, shape, measurements, measurements_source,
      measurements_sigma_cm, measurements_override, glb_path, pose, shape_hash, confidence)
    values (
      (v ->> 'id')::uuid, j.user_id, (v ->> 'body_model')::public.body_model, v ->> 'model_version',
      v -> 'shape', v -> 'measurements', (v ->> 'measurements_source')::public.measurement_source,
      private.jsonb_nullif(v -> 'measurements_sigma_cm'),
      private.jsonb_nullif(v -> 'measurements_override'),
      private.storage_ref_to_path(v ->> 'glb_url', r.output_paths),
      (v ->> 'pose')::public.avatar_pose, v ->> 'shape_hash', (v ->> 'confidence')::numeric)
    on conflict (id) do nothing;
    v_output := jsonb_build_object('avatar_id', v -> 'id');

  -- Éxito: colorimetría ---------------------------------------------------------------
  elsif j.type = 'color' then
    v := p_output -> 'color_profile';
    if (v ->> 'user_id')::uuid is distinct from j.user_id then
      raise exception 'color_profile.user_id does not match job owner' using errcode = '22023';
    end if;
    insert into public.color_profiles (
      id, user_id, season, undertone, value, intensity, contrast, scores, skin_lab, hair_lab,
      eye_lab, palettes, metal, confidence, alternatives, white_balanced, user_overridden,
      pipeline_version, hair_dyed, ita, skin_hue_deg, quality)
    values (
      (v ->> 'id')::uuid, j.user_id, (v ->> 'season')::public.color_season,
      (v ->> 'undertone')::public.undertone, (v ->> 'value')::public.color_value,
      (v ->> 'intensity')::public.color_intensity, (v ->> 'contrast')::public.contrast_level,
      v -> 'scores', v -> 'skin_lab', private.jsonb_nullif(v -> 'hair_lab'),
      private.jsonb_nullif(v -> 'eye_lab'), v -> 'palettes', (v ->> 'metal')::public.metal,
      (v ->> 'confidence')::numeric, private.jsonb_nullif(v -> 'alternatives'),
      (v ->> 'white_balanced')::boolean, false, v ->> 'pipeline_version',
      (v ->> 'hair_dyed')::boolean, (v ->> 'ita')::numeric, (v ->> 'skin_hue_deg')::numeric,
      private.jsonb_nullif(v -> 'quality'))
    on conflict (id) do nothing;
    v_output := jsonb_build_object('color_profile_id', v -> 'id');

  -- Éxito: prenda (respeta user_corrected_fields) ------------------------------------
  elsif j.type = 'garment' then
    v := p_output -> 'garment';
    gid := (j.input ->> 'garment_id')::uuid;
    if (v ->> 'id')::uuid is distinct from gid then
      raise exception 'garment.id does not match job input' using errcode = '22023';
    end if;
    if (v ->> 'user_id')::uuid is distinct from j.user_id then
      raise exception 'garment.user_id does not match job owner' using errcode = '22023';
    end if;
    -- El embedding no forma parte de Garment ni se guarda en jobs.output (512
    -- números que la app no necesita): va solo a garments.embedding.
    emb := private.jsonb_nullif(p_output -> 'embedding');
    v_output := jsonb_build_object('garment_id', gid);
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
        design_fit_confidence = case when 'design_fit' = any (c) and g.design_fit is not null then null
                                else (v ->> 'design_fit_confidence')::numeric end,
        size_label       = case when 'size_label' = any (c) then g.size_label else v ->> 'size_label' end,
        level            = (v ->> 'level')::smallint,
        template_id      = v ->> 'template_id',
        image_path       = private.storage_ref_to_path(v ->> 'image_url', r.output_paths),
        glb_path         = private.storage_ref_to_path(v ->> 'glb_url', r.output_paths),
        sewing_pattern_path   = private.storage_ref_to_path(v ->> 'sewing_pattern_url', r.output_paths),
        sewing_pattern_format = (v ->> 'sewing_pattern_format')::public.sewing_pattern_format,
        embedding        = case when emb is null then g.embedding
                                else (emb -> 'vector')::text::extensions.vector(512) end,
        embedding_model  = case when emb is null then g.embedding_model else emb ->> 'model' end,
        pipeline_version = v ->> 'pipeline_version'
      where id = gid;

      if not ('measurements' = any (c)) then
        insert into public.garment_measurements (garment_id, size_label, zones, source)
        select gid, m ->> 'size_label', m -> 'zones', (m ->> 'source')::public.garment_measurement_source
          from jsonb_array_elements(coalesce(v -> 'measurements', '[]')) as m
        on conflict (garment_id, size_label) do update
          set zones = excluded.zones, source = excluded.source;
      end if;
    else
      v_output := null;  -- la prenda se borró mientras tanto: solo se cierra el job
    end if;

  -- Éxito: drapeado -------------------------------------------------------------------
  elsif j.type = 'drape' then
    if p_output ->> 'cache_key' is distinct from r.cache_key then
      raise exception 'cache_key does not match the one issued for this job' using errcode = '22023';
    end if;
    v_output := jsonb_build_object('drape_cache_id', null, 'fit_result_id', null, 'cache_hit', false);
    select a.shape_hash into v_shape
      from public.avatars a where a.id = (j.input ->> 'avatar_id')::uuid and a.user_id = j.user_id;
    if found and exists (select 1 from public.garments where id = (j.input ->> 'garment_id')::uuid) then
      fr := private.jsonb_nullif(p_output -> 'fit_result');
      if fr is not null then
        if fr ->> 'avatar_id' is distinct from j.input ->> 'avatar_id'
           or fr ->> 'garment_id' is distinct from j.input ->> 'garment_id' then
          raise exception 'fit_result does not match job input' using errcode = '22023';
        end if;
        if (fr ->> 'user_id')::uuid is distinct from j.user_id then
          raise exception 'fit_result.user_id does not match job owner' using errcode = '22023';
        end if;
        insert into public.fit_results (
          id, user_id, avatar_id, garment_id, size_label, zones, verdict, effective_fit,
          matches_design_fit, size_offset, score, recommended_size_label, method, confidence)
        values (
          (fr ->> 'id')::uuid, j.user_id, (fr ->> 'avatar_id')::uuid, (fr ->> 'garment_id')::uuid,
          fr ->> 'size_label', fr -> 'zones', (fr ->> 'verdict')::public.fit_verdict,
          (fr ->> 'effective_fit')::public.design_fit, (fr ->> 'matches_design_fit')::boolean,
          (fr ->> 'size_offset')::numeric,
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
            last_used_at = now()
      returning id into v_dc;
      v_output := jsonb_build_object('drape_cache_id', v_dc,
                                     'fit_result_id', (select d.fit_result_id from public.drape_cache d where d.id = v_dc),
                                     'cache_hit', false);
    end if;  -- avatar o prenda borrados mientras tanto: no se cachea
  end if;

  update public.jobs
     set status = 'succeeded', progress = 1, output = v_output, error = null,
         started_at = coalesce(started_at, now()), finished_at = now(),
         worker_version = coalesce(p_worker_version, worker_version),
         fake = coalesce(p_fake, false),
         input_deleted_at = p_input_deleted_at
   where id = p_job_id;

  return jsonb_build_object('result', 'applied', 'type', j.type, 'status', 'succeeded');
end;
$$;

-- -----------------------------------------------------------------------------
-- Cascada hacia `jobs` al borrar lo que un job creó o usó
-- -----------------------------------------------------------------------------
create or replace function private.on_avatar_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Drapeados en curso sobre este avatar: ya no tienen sentido.
  update public.jobs set status = 'canceled', finished_at = now()
   where user_id = old.user_id and type = 'drape' and status in ('queued', 'running')
     and input ->> 'avatar_id' = old.id::text;
  update public.jobs set output = null
   where user_id = old.user_id and type = 'avatar' and output ->> 'avatar_id' = old.id::text;
  update public.jobs set output = null, input = input - 'avatar_id'
   where user_id = old.user_id and type = 'drape' and input ->> 'avatar_id' = old.id::text;
  return old;
end;
$$;

create trigger avatars_cascade_to_jobs
  after delete on public.avatars
  for each row execute function private.on_avatar_deleted();

create or replace function private.on_color_profile_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs set output = null
   where user_id = old.user_id and type = 'color' and output ->> 'color_profile_id' = old.id::text;
  return old;
end;
$$;

create trigger color_profiles_cascade_to_jobs
  after delete on public.color_profiles
  for each row execute function private.on_color_profile_deleted();

create or replace function private.on_garment_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id is null then
    return old;  -- prenda de catálogo
  end if;
  update public.jobs set status = 'canceled', finished_at = now()
   where user_id = old.user_id and type in ('garment', 'drape') and status in ('queued', 'running')
     and input ->> 'garment_id' = old.id::text;
  update public.jobs set output = null, input = input - 'garment_id'
   where user_id = old.user_id and type in ('garment', 'drape') and input ->> 'garment_id' = old.id::text;
  return old;
end;
$$;

create trigger garments_cascade_to_jobs
  after delete on public.garments
  for each row execute function private.on_garment_deleted();

-- -----------------------------------------------------------------------------
-- Retirada de consentimiento (sustituye a la de 0005): A1 y A2
-- -----------------------------------------------------------------------------
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
    -- Primero se cancelan los jobs en curso: así su foto deja de poder subirse
    -- (guard de Storage) y su callback ya no crea nada.
    update public.jobs set status = 'canceled', finished_at = now()
     where user_id = new.user_id and type = 'avatar' and status in ('queued', 'running');
    -- Avatares obtenidos de fotos (los manuales no dependen del consentimiento).
    -- En cascada: fit_results, drape_cache y, por trigger, los jobs que los citan.
    delete from public.avatars where user_id = new.user_id and measurements_source <> 'manual';
    update public.jobs set output = null
     where user_id = new.user_id and type = 'avatar' and output is not null;
  elsif new.purpose = 'color_analysis' then
    update public.jobs set status = 'canceled', finished_at = now()
     where user_id = new.user_id and type = 'color' and status in ('queued', 'running');
    -- A2: todo perfil de color, también los corregidos a mano (D10).
    delete from public.color_profiles where user_id = new.user_id;
    update public.jobs set output = null
     where user_id = new.user_id and type = 'color' and output is not null;
  elsif new.purpose = 'personalization' then
    -- Recomendaciones generadas para el usuario.
    delete from public.outfits where user_id = new.user_id and source <> 'user';
  end if;
  -- analytics: no hay datos de analítica en esta base de datos.
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Purga de jobs terminados (A1): 30 días, nunca antes de borrar sus fotos
-- -----------------------------------------------------------------------------
create or replace function public.purge_finished_jobs(p_older_than interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.jobs j
   where j.status in ('succeeded', 'failed', 'canceled')
     and j.finished_at < now() - p_older_than
     and (j.input_deleted_at is not null
          or not exists (select 1 from public.job_runs r
                          where r.job_id = j.id and cardinality(r.input_paths) > 0));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_finished_jobs(interval) from public, anon, authenticated;
grant execute on function public.purge_finished_jobs(interval) to service_role;
revoke all on function private.on_avatar_deleted() from public, anon, authenticated;
revoke all on function private.on_color_profile_deleted() from public, anon, authenticated;
revoke all on function private.on_garment_deleted() from public, anon, authenticated;
revoke all on function private.minimize_finished_job() from public, anon, authenticated;
revoke all on function private.retained_job_input(public.job_type, jsonb) from public, anon, authenticated;
revoke all on function private.job_result(public.job_type, jsonb) from public, anon, authenticated;

select cron.schedule(
  'maintenance-daily', '17 3 * * *',
  $$ select public.purge_drape_cache(); select public.purge_finished_jobs();
     select private.invoke_maintenance(array['gc_assets']); $$);
