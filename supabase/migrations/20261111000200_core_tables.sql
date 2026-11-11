-- =============================================================================
-- Probador virtual 3D · 0002 · Tablas del modelo de datos
--
-- Convención: cada columna se llama igual que el campo del contrato
-- (packages/contracts/src/index.ts) y los objetos anidados del contrato son
-- jsonb, para que una fila se serialice tal cual. Excepciones deliberadas:
--
--   * Los campos `*_url` del contrato apuntan a objetos de Storage privados.
--     Postgres guarda la RUTA (`<bucket>/<carpeta>/<fichero>`) en una columna
--     `*_path`; la app o la API la firman al servir (docs/architecture.md §3.3).
--     Afecta a avatars.glb_path, garments.image_path, garments.glb_path,
--     garments.sewing_pattern_path, outfits.preview_path y drape_cache.glb_path
--     (la tabla completa es STORAGE_URL_COLUMNS en el contrato).
--   * Garment.measurements vive en la tabla garment_measurements; la vista
--     public.garments_with_measurements la vuelve a juntar.
--
-- Todas las claves foráneas hacia el usuario terminan en auth.users con
-- ON DELETE CASCADE: borrar el usuario de Auth borra todas sus filas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles ("users" en el plan): una fila por usuario de Auth
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text check (char_length(display_name) <= 80),
  locale           text not null default 'es' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- El usuario declara que cumple la edad mínima (docs/architecture.md §4).
  -- Solo se guarda cuándo lo confirmó, no la fecha de nacimiento.
  age_confirmed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.profiles is 'Perfil mínimo del usuario. Se crea solo al darse de alta en Auth.';

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Alta automática del perfil al crear el usuario en Auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- consents: un registro por consentimiento otorgado; retirar = withdrawn_at
-- -----------------------------------------------------------------------------
create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  purpose      public.consent_purpose not null,
  -- Versión del texto legal que el usuario aceptó, p. ej. `body_scan-2026-11`.
  text_version text not null check (char_length(text_version) between 1 and 64),
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint consents_withdrawn_after_granted check (withdrawn_at is null or withdrawn_at >= granted_at)
);
comment on table public.consents is
  'Consentimientos por tratamiento (RGPD). No se borran al retirarlos: quedan como prueba hasta el borrado de la cuenta.';

create index consents_user_purpose_active_idx
  on public.consents (user_id, purpose) where withdrawn_at is null;

-- -----------------------------------------------------------------------------
-- avatars (contrato: Avatar)
-- -----------------------------------------------------------------------------
create table public.avatars (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  body_model            public.body_model not null,
  model_version         text not null,
  -- Forma en el espacio de parámetros de body_model (contrato: BodyShape). Opaca
  -- para todo salvo el pipeline de avatar.
  shape                 jsonb not null check (
                          jsonb_typeof(shape) = 'object'
                          and jsonb_typeof(shape -> 'params') = 'array'
                          and jsonb_array_length(shape -> 'params') between 1 and 512),
  measurements          jsonb not null check (
                          jsonb_typeof(measurements) = 'object'
                          and measurements ?& array['height_cm', 'chest_cm', 'waist_cm', 'hip_cm',
                                                    'shoulder_width_cm', 'arm_length_cm', 'inseam_cm']),
  measurements_source   public.measurement_source not null,
  measurements_sigma_cm jsonb check (measurements_sigma_cm is null or jsonb_typeof(measurements_sigma_cm) = 'object'),
  measurements_override jsonb check (measurements_override is null or jsonb_typeof(measurements_override) = 'object'),
  -- Contrato: glb_url (URL firmada). Aquí: ruta `assets/<user_id>/avatars/<fichero>.glb`.
  glb_path              text not null check (glb_path like 'assets/%'),
  pose                  public.avatar_pose not null,
  shape_hash            text not null,
  confidence            numeric not null check (confidence between 0 and 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index avatars_user_created_idx on public.avatars (user_id, created_at desc);
create trigger avatars_set_updated_at before update on public.avatars
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- color_profiles (contrato: ColorProfile)
-- -----------------------------------------------------------------------------
create table public.color_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  season           public.color_season not null,
  undertone        public.undertone not null,
  value            public.color_value not null,
  intensity        public.color_intensity not null,
  contrast         public.contrast_level not null,
  scores           jsonb not null check (scores ?& array['undertone', 'value', 'intensity', 'contrast']),
  skin_lab         jsonb not null check (skin_lab ?& array['l', 'a', 'b']),
  hair_lab         jsonb check (hair_lab is null or hair_lab ?& array['l', 'a', 'b']),
  hair_dyed        boolean,
  eye_lab          jsonb check (eye_lab is null or eye_lab ?& array['l', 'a', 'b']),
  ita              numeric,
  skin_hue_deg     numeric check (skin_hue_deg is null or skin_hue_deg between 0 and 360),
  palettes         jsonb not null check (
                     palettes ?& array['best', 'neutrals', 'accents', 'avoid']
                     and jsonb_array_length(palettes -> 'best') >= 1),
  metal            public.metal not null,
  confidence       numeric not null check (confidence between 0 and 1),
  alternatives     jsonb check (alternatives is null or jsonb_typeof(alternatives) = 'array'),
  white_balanced   boolean not null,
  quality          jsonb check (quality is null or quality ?& array['flags', 'capture_score']),
  user_overridden  boolean not null default false,
  pipeline_version text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index color_profiles_user_created_idx on public.color_profiles (user_id, created_at desc);
create trigger color_profiles_set_updated_at before update on public.color_profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- store_products (contrato: StoreProduct). Catálogo público de afiliación.
-- Se crea antes que garments porque garments.store_product_id lo referencia.
-- -----------------------------------------------------------------------------
create table public.store_products (
  id            uuid primary key default gen_random_uuid(),
  network       public.affiliate_network not null,
  merchant      text not null,
  external_id   text not null,
  title         text not null,
  brand         text,
  category      public.garment_category not null,
  target_gender public.target_gender,
  affiliate_url text not null check (affiliate_url ~ '^https://'),
  image_urls    text[] not null check (cardinality(image_urls) >= 1),
  price         jsonb not null check (
                  jsonb_typeof(price -> 'amount') = 'number' and (price ->> 'amount')::numeric >= 0
                  and (price ->> 'currency') ~ '^[A-Z]{3}$'),
  sale_price    jsonb check (
                  sale_price is null or (
                    jsonb_typeof(sale_price -> 'amount') = 'number' and (sale_price ->> 'amount')::numeric >= 0
                    and (sale_price ->> 'currency') ~ '^[A-Z]{3}$')),
  sizes         jsonb not null default '[]' check (jsonb_typeof(sizes) = 'array'),
  garment_id    uuid,  -- FK añadida tras crear garments (referencia circular)
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint store_products_feed_key unique (network, merchant, external_id)
);
create index store_products_category_idx on public.store_products (category, target_gender);
create index store_products_last_seen_idx on public.store_products (last_seen_at);
create index store_products_price_idx on public.store_products (((price ->> 'amount')::numeric));
create trigger store_products_set_updated_at before update on public.store_products
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- garments (contrato: Garment, salvo `measurements`, que está en
-- garment_measurements). user_id null = prenda de catálogo de tienda.
-- -----------------------------------------------------------------------------
create table public.garments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid default auth.uid() references public.profiles (id) on delete cascade,
  store_product_id      uuid references public.store_products (id) on delete set null,
  status                public.garment_status not null default 'processing',
  -- category, design_fit e image_path pueden faltar mientras status <> ready
  -- (contrato: PendingGarment; la prenda se crea antes de que el worker la etiquete).
  category              public.garment_category,
  name                  text,
  brand                 text,
  attributes            jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  colors                jsonb not null default '[]' check (jsonb_typeof(colors) = 'array'),
  design_fit            public.design_fit,
  design_fit_confidence numeric check (design_fit_confidence is null or design_fit_confidence between 0 and 1),
  size_label            text,
  level                 smallint not null default 1 check (level in (1, 2, 3)),
  template_id           text,
  -- Contrato: image_url / glb_url / sewing_pattern_url. Aquí rutas `assets/...`.
  image_path            text check (image_path like 'assets/%'),
  glb_path              text check (glb_path like 'assets/%'),
  -- Patrón de costura (especificación de GarmentCode, JSON) del que sale el GLB
  -- y que el drapeado simula. Null en prendas de nivel 3 (3D nativo de marca).
  sewing_pattern_path   text check (sewing_pattern_path like 'assets/%'),
  sewing_pattern_format public.sewing_pattern_format,
  user_corrected_fields text[] not null default '{}',
  pipeline_version      text not null default 'pending',
  -- Embedding de imagen para recomendaciones (pgvector, coseno). 512 dimensiones
  -- = CLIP ViT-B/32 / FashionCLIP. Llega en GarmentJobOutput.embedding; no se
  -- sirve a la app (no está en la vista ni en Garment).
  embedding             extensions.vector(512),
  embedding_model       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint garments_ready_is_complete check (
    status <> 'ready' or (
      category is not null and design_fit is not null and image_path is not null
      and jsonb_array_length(colors) >= 1)),
  constraint garments_embedding_model check (embedding is null or embedding_model is not null)
);
create index garments_user_created_idx on public.garments (user_id, created_at desc) where user_id is not null;
create index garments_catalog_category_idx on public.garments (category) where user_id is null;
create index garments_store_product_idx on public.garments (store_product_id) where store_product_id is not null;
create index garments_embedding_hnsw_idx on public.garments
  using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;
create trigger garments_set_updated_at before update on public.garments
  for each row execute function private.set_updated_at();

alter table public.store_products
  add constraint store_products_garment_id_fkey
  foreign key (garment_id) references public.garments (id) on delete set null;
create index store_products_garment_idx on public.store_products (garment_id) where garment_id is not null;

-- -----------------------------------------------------------------------------
-- garment_measurements (contrato: GarmentSizeMeasurements, una fila por talla)
-- -----------------------------------------------------------------------------
create table public.garment_measurements (
  id         uuid primary key default gen_random_uuid(),
  garment_id uuid not null references public.garments (id) on delete cascade,
  size_label text not null check (char_length(size_label) between 1 and 32),
  zones      jsonb not null check (jsonb_typeof(zones) = 'object'),
  source     public.garment_measurement_source not null,
  created_at timestamptz not null default now(),
  constraint garment_measurements_garment_size_key unique (garment_id, size_label)
);

-- -----------------------------------------------------------------------------
-- fit_results (contrato: FitResult). user_id = dueño del avatar (lo comprueba
-- complete_job); está desnormalizado para que RLS no tenga que pasar por avatars.
-- -----------------------------------------------------------------------------
create table public.fit_results (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  avatar_id              uuid not null references public.avatars (id) on delete cascade,
  garment_id             uuid not null references public.garments (id) on delete cascade,
  size_label             text not null,
  zones                  jsonb not null check (jsonb_typeof(zones) = 'array' and jsonb_array_length(zones) >= 1),
  verdict                public.fit_verdict not null,
  effective_fit          public.design_fit not null,
  matches_design_fit     boolean not null,
  size_offset            numeric,
  score                  numeric not null check (score between 0 and 1),
  recommended_size_label text,
  method                 public.fit_method not null,
  confidence             numeric not null check (confidence between 0 and 1),
  created_at             timestamptz not null default now()
);
create index fit_results_lookup_idx on public.fit_results (avatar_id, garment_id, size_label, created_at desc);
create index fit_results_garment_idx on public.fit_results (garment_id);
create index fit_results_user_idx on public.fit_results (user_id);

-- -----------------------------------------------------------------------------
-- user_fit_preferences (contrato: UserFitPreferences)
-- -----------------------------------------------------------------------------
create table public.user_fit_preferences (
  user_id          uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  -- Fit preferido por defecto.
  default_fit      public.design_fit not null default 'regular',
  -- Por categoría: {"jeans": "slim", "hoodie": "oversize"}.
  fit_by_category  jsonb not null default '{}' check (jsonb_typeof(fit_by_category) = 'object'),
  -- Holgura preferida por categoría y zona (docs/research/fit.md §6):
  -- {"shirt": {"chest": {"preferred_cm": 12, "tolerance_cm": 4, "observations": 3}}}.
  ease_by_category jsonb not null default '{}' check (jsonb_typeof(ease_by_category) = 'object'),
  -- Gusto por siluetas oversize de diseño, aparte de la talla. Null = sin dato.
  likes_oversize   boolean,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger user_fit_preferences_set_updated_at before update on public.user_fit_preferences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- outfits (contrato: Outfit)
-- -----------------------------------------------------------------------------
create table public.outfits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- El contrato lo exige, pero si el usuario borra el avatar (o retira el
  -- consentimiento de escaneo) el outfit se conserva sin avatar.
  avatar_id    uuid references public.avatars (id) on delete set null,
  name         text,
  items        jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) >= 1),
  source       public.outfit_source not null default 'user',
  scores       jsonb check (scores is null or scores ?& array['compatibility', 'color', 'fit', 'total']),
  occasion     text,
  -- Contrato: preview_url. Aquí ruta `assets/<user_id>/outfits/<fichero>`.
  preview_path text check (preview_path like 'assets/%'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index outfits_user_created_idx on public.outfits (user_id, created_at desc);
create index outfits_avatar_idx on public.outfits (avatar_id) where avatar_id is not null;
create index outfits_items_gin_idx on public.outfits using gin (items jsonb_path_ops);
create trigger outfits_set_updated_at before update on public.outfits
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- drape_cache (contrato: DrapeCache): un GLB drapeado por combinación
-- cache_key = sha256(shape_hash|garment_id|versión de prenda|talla|pose|calidad|tejido|simulador)
-- -----------------------------------------------------------------------------
create table public.drape_cache (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  cache_key         text not null,
  avatar_id         uuid not null references public.avatars (id) on delete cascade,
  garment_id        uuid not null references public.garments (id) on delete cascade,
  size_label        text not null,
  pose              public.avatar_pose not null,
  quality           public.drape_quality not null,
  shape_hash        text not null,
  simulator_version text not null,
  glb_path          text not null check (glb_path like 'assets/%'),
  fit_result_id     uuid references public.fit_results (id) on delete set null,
  hit_count         integer not null default 0 check (hit_count >= 0),
  last_used_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint drape_cache_user_key unique (user_id, cache_key)
);
create index drape_cache_avatar_idx on public.drape_cache (avatar_id);
create index drape_cache_garment_idx on public.drape_cache (garment_id);
create index drape_cache_last_used_idx on public.drape_cache (last_used_at);

-- -----------------------------------------------------------------------------
-- jobs (contrato: Job). Fuente de verdad y cola. Columnas idénticas al contrato;
-- los datos internos de despacho van en job_runs.
-- -----------------------------------------------------------------------------
create table public.jobs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references public.profiles (id) on delete cascade,
  type           public.job_type not null,
  status         public.job_status not null default 'queued',
  progress       numeric not null default 0 check (progress between 0 and 1),
  stage          text,
  input          jsonb not null check (jsonb_typeof(input) = 'object'),
  output         jsonb check (output is null or jsonb_typeof(output) = 'object'),
  error          jsonb check (error is null or error ?& array['code', 'message', 'retryable']),
  attempts       integer not null default 0 check (attempts >= 0),
  worker_version text,
  -- El resultado lo generó un worker en modo fake (JobCallback.fake).
  fake           boolean not null default false,
  -- Cuándo borró la API las fotos de entrada de raw-uploads. Solo lo escribe la
  -- API (complete_job / mark_job_inputs_deleted), nunca el worker.
  input_deleted_at timestamptz,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  constraint jobs_output_only_when_succeeded check (output is null or status = 'succeeded'),
  constraint jobs_error_only_when_failed check (error is null or status = 'failed'),
  constraint jobs_finished_when_terminal check (
    (status in ('succeeded', 'failed', 'canceled')) = (finished_at is not null))
);
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);
create index jobs_pending_idx on public.jobs (status, created_at) where status in ('queued', 'running');

-- Datos internos de cada job: rutas de entrada a borrar, despacho, plazo.
-- Solo los usa la API (service_role); nunca la app.
create table public.job_runs (
  job_id              uuid primary key references public.jobs (id) on delete cascade,
  -- Rutas en raw-uploads (con prefijo de bucket) que el callback debe borrar.
  input_paths         text[] not null default '{}',
  -- Rutas que el worker puede escribir (SignedUpload.path) en este intento.
  output_paths        text[] not null default '{}',
  -- Clave de caché del drapeado calculada por la API.
  cache_key           text,
  dispatched_at       timestamptz,
  deadline_at         timestamptz,
  last_dispatch_error text,
  updated_at          timestamptz not null default now()
);
create index job_runs_undispatched_idx on public.job_runs (job_id) where dispatched_at is null;
create trigger job_runs_set_updated_at before update on public.job_runs
  for each row execute function private.set_updated_at();

-- Realtime: la app sigue el progreso de sus jobs (RLS se aplica también aquí).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vista: Garment completo como en el contrato (con `measurements`).
-- security_invoker: respeta el RLS de quien consulta.
-- -----------------------------------------------------------------------------
create view public.garments_with_measurements
with (security_invoker = true)
as
select
  g.id, g.user_id, g.store_product_id, g.status, g.category, g.name, g.brand,
  g.attributes, g.colors, g.design_fit, g.design_fit_confidence, g.size_label,
  coalesce(
    (select jsonb_agg(jsonb_build_object('size_label', m.size_label, 'zones', m.zones, 'source', m.source)
                      order by m.size_label)
       from public.garment_measurements m where m.garment_id = g.id),
    '[]'::jsonb) as measurements,
  g.level, g.template_id, g.image_path, g.glb_path, g.sewing_pattern_path, g.sewing_pattern_format,
  g.user_corrected_fields,
  g.pipeline_version, g.created_at, g.updated_at
from public.garments g;
