-- =============================================================================
-- Probador virtual 3D · 0004 · Buckets de Storage y sus políticas
--
--   raw-uploads  privado y EFÍMERO. Fotos de cuerpo, selfies y fotos originales
--                de prendas. Ruta: raw-uploads/<user_id>/<uuid>.<ext>
--                · Subida: solo con URL firmada que emite create-job.
--                · Lectura: solo el worker, con URL firmada de 15 min.
--                · Borrado: job-callback al terminar el job; red de seguridad
--                  de pg_cron (función maintenance) a los 60 minutos.
--   assets       privado. GLB y recortes generados por el pipeline.
--                · <user_id>/avatars/…, <user_id>/garments/…, <user_id>/drapes/…
--                  los escribe el worker con URL firmada.
--                · <user_id>/outfits/… miniaturas que sube la propia app.
--                · catalog/… prendas de tienda, legibles por cualquiera.
--
-- Las URLs firmadas que emite la API (service_role) no pasan por estas
-- políticas; las políticas gobiernan lo que la app hace con su propio JWT.
-- Nota: en Supabase no se puede borrar un fichero con DELETE sobre
-- storage.objects (trigger storage.protect_delete y, además, solo se borraría
-- la fila y no el fichero). Todo borrado pasa por la API de Storage.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-uploads', 'raw-uploads', false, 10 * 1024 * 1024,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('assets', 'assets', false, 50 * 1024 * 1024,
   array['model/gltf-binary', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- raw-uploads ---------------------------------------------------------------------
-- Sin políticas de lectura ni de escritura para la app: solo URLs firmadas.
-- El usuario sí puede borrar sus propias fotos (p. ej. si cancela la captura).
create policy raw_uploads_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'raw-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- assets ----------------------------------------------------------------------------
-- Leer (y por tanto firmar URLs de) lo propio.
create policy assets_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Catálogo de tiendas: lectura para todos.
create policy assets_select_catalog on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = 'catalog');

-- Miniaturas de outfits: la app las sube, reemplaza y borra.
create policy assets_insert_own_outfits on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'outfits');
create policy assets_update_own_outfits on storage.objects
  for update to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'outfits')
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'outfits');
create policy assets_delete_own_outfits on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] = 'outfits');
