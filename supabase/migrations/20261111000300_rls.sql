-- =============================================================================
-- Probador virtual 3D · 0003 · Row Level Security y permisos
--
-- Regla general: cada usuario solo ve y toca lo suyo (auth.uid()).
-- Lo que solo produce el pipeline (avatares, perfiles de color, resultados de
-- fit, caché de drapeado, jobs) se escribe con la clave de servicio desde las
-- Edge Functions; la app solo puede leerlo, borrarlo o corregir columnas
-- concretas (rectificación RGPD).
-- store_products y las prendas de catálogo (garments.user_id null) son de
-- lectura pública.
--
-- `(select auth.uid())` en lugar de `auth.uid()` para que Postgres lo evalúe
-- una vez por consulta y no por fila.
-- =============================================================================

alter table public.profiles             enable row level security;
alter table public.consents             enable row level security;
alter table public.avatars              enable row level security;
alter table public.color_profiles       enable row level security;
alter table public.store_products       enable row level security;
alter table public.garments             enable row level security;
alter table public.garment_measurements enable row level security;
alter table public.fit_results          enable row level security;
alter table public.user_fit_preferences enable row level security;
alter table public.outfits              enable row level security;
alter table public.drape_cache          enable row level security;
alter table public.jobs                 enable row level security;
alter table public.job_runs             enable row level security;

-- Defensa en profundidad: además de RLS, se quitan los privilegios que la app
-- no necesita. anon no tiene nada salvo el catálogo.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.store_products to anon, authenticated;
grant select on public.garments, public.garment_measurements, public.garments_with_measurements to anon;

-- -----------------------------------------------------------------------------
-- profiles: leer y editar el propio. Alta por trigger; baja por delete-account.
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, locale, age_confirmed_at) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- consents: leer los propios, otorgar (insert) y retirar (update de withdrawn_at).
-- No se pueden "des-retirar" ni borrar.
-- -----------------------------------------------------------------------------
grant select, insert on public.consents to authenticated;
grant update (withdrawn_at) on public.consents to authenticated;

create policy consents_select_own on public.consents
  for select to authenticated using (user_id = (select auth.uid()));
create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (user_id = (select auth.uid()) and withdrawn_at is null);
create policy consents_withdraw_own on public.consents
  for update to authenticated
  using (user_id = (select auth.uid()) and withdrawn_at is null)
  with check (user_id = (select auth.uid()) and withdrawn_at is not null);

-- -----------------------------------------------------------------------------
-- avatars: leer, borrar y corregir medidas (measurements_override).
-- -----------------------------------------------------------------------------
grant select, delete on public.avatars to authenticated;
grant update (measurements_override) on public.avatars to authenticated;

create policy avatars_select_own on public.avatars
  for select to authenticated using (user_id = (select auth.uid()));
create policy avatars_update_own on public.avatars
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy avatars_delete_own on public.avatars
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- color_profiles: leer, borrar y elegir la estación a mano.
-- -----------------------------------------------------------------------------
grant select, delete on public.color_profiles to authenticated;
grant update (season, undertone, value, intensity, contrast, palettes, metal, user_overridden)
  on public.color_profiles to authenticated;

create policy color_profiles_select_own on public.color_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy color_profiles_update_own on public.color_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy color_profiles_delete_own on public.color_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- store_products: lectura pública; escritura solo por la ingesta (service_role).
-- -----------------------------------------------------------------------------
create policy store_products_public_read on public.store_products
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- garments: armario propio (CRUD) + catálogo (user_id null) de solo lectura.
-- -----------------------------------------------------------------------------
grant select, insert, delete on public.garments to authenticated;
grant update (status, category, name, brand, attributes, colors, design_fit, size_label,
              user_corrected_fields) on public.garments to authenticated;

create policy garments_select_own_or_catalog on public.garments
  for select to anon, authenticated
  using (user_id is null or user_id = (select auth.uid()));
-- La app solo crea prendas propias en `processing`; el resto lo rellena el job.
create policy garments_insert_own on public.garments
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'processing' and store_product_id is null
    and glb_path is null and image_path is null and embedding is null);
create policy garments_update_own on public.garments
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy garments_delete_own on public.garments
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- garment_measurements: siguen al dueño de la prenda.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.garment_measurements to authenticated;

create policy garment_measurements_select on public.garment_measurements
  for select to anon, authenticated
  using (exists (
    select 1 from public.garments g
    where g.id = garment_id and (g.user_id is null or g.user_id = (select auth.uid()))));
create policy garment_measurements_insert_own on public.garment_measurements
  for insert to authenticated
  with check (exists (
    select 1 from public.garments g where g.id = garment_id and g.user_id = (select auth.uid())));
create policy garment_measurements_update_own on public.garment_measurements
  for update to authenticated
  using (exists (
    select 1 from public.garments g where g.id = garment_id and g.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.garments g where g.id = garment_id and g.user_id = (select auth.uid())));
create policy garment_measurements_delete_own on public.garment_measurements
  for delete to authenticated
  using (exists (
    select 1 from public.garments g where g.id = garment_id and g.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- fit_results: el dueño es el del avatar. Lectura y borrado.
-- -----------------------------------------------------------------------------
grant select, delete on public.fit_results to authenticated;

create policy fit_results_select_own on public.fit_results
  for select to authenticated
  using (exists (select 1 from public.avatars a where a.id = avatar_id and a.user_id = (select auth.uid())));
create policy fit_results_delete_own on public.fit_results
  for delete to authenticated
  using (exists (select 1 from public.avatars a where a.id = avatar_id and a.user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- user_fit_preferences: CRUD propio.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.user_fit_preferences to authenticated;

create policy user_fit_preferences_all_own on public.user_fit_preferences
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- outfits: CRUD propio; el avatar, si lo hay, también tiene que ser propio.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.outfits to authenticated;

create policy outfits_select_own on public.outfits
  for select to authenticated using (user_id = (select auth.uid()));
create policy outfits_insert_own on public.outfits
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (avatar_id is null or exists (
      select 1 from public.avatars a where a.id = avatar_id and a.user_id = (select auth.uid()))));
create policy outfits_update_own on public.outfits
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (avatar_id is null or exists (
      select 1 from public.avatars a where a.id = avatar_id and a.user_id = (select auth.uid()))));
create policy outfits_delete_own on public.outfits
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- drape_cache: lectura del propio; la escribe la API.
-- -----------------------------------------------------------------------------
grant select on public.drape_cache to authenticated;

create policy drape_cache_select_own on public.drape_cache
  for select to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- jobs: solo lectura de los propios (y Realtime). Crear: Edge Function create-job.
-- -----------------------------------------------------------------------------
grant select on public.jobs to authenticated;

create policy jobs_select_own on public.jobs
  for select to authenticated using (user_id = (select auth.uid()));

-- job_runs: sin políticas = invisible para anon/authenticated; solo service_role.

-- La vista hereda el RLS de garments y garment_measurements.
grant select on public.garments_with_measurements to authenticated;
