-- Cola de jobs, persistencia del callback, reintentos, retirada de
-- consentimiento, bookkeeping del borrado de fotos y borrado de cuenta.
-- (El borrado físico de ficheros por la API de Storage se prueba en
-- supabase/tests/e2e/photo_deletion.test.ts.)
begin;
\ir helpers/setup.psql
select plan(46);

select pg_temp.create_user('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local');
select pg_temp.create_user('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

insert into public.consents (id, user_id, purpose, text_version) values
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'body_scan', 'v1');

-- ---------------------------------------------------------------------------
-- Despacho: solo se reservan jobs cuyas fotos ya están en raw-uploads
-- ---------------------------------------------------------------------------
insert into public.jobs (id, user_id, type, input) values
  ('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'avatar',
   '{"photo_path":"raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/p1.jpg","height_cm":172,"consent_id":"c0000000-0000-4000-8000-00000000000a"}');
insert into public.job_runs (job_id, input_paths) values
  ('10000000-0000-4000-8000-000000000001', array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/p1.jpg']);

select is_empty($$ select * from public.claim_jobs_for_dispatch('10000000-0000-4000-8000-000000000001') $$,
                'no se despacha un job cuya foto aún no se ha subido');

insert into storage.objects (bucket_id, name, owner_id)
values ('raw-uploads', 'aaaaaaaa-0000-4000-8000-000000000001/p1.jpg', 'aaaaaaaa-0000-4000-8000-000000000001');

select results_eq($$ select attempt from public.claim_jobs_for_dispatch('10000000-0000-4000-8000-000000000001') $$,
                  $$ values (1) $$, 'con la foto subida se reserva y consume el intento 1');
select is_empty($$ select * from public.claim_jobs_for_dispatch('10000000-0000-4000-8000-000000000001') $$,
                'un job ya despachado no se vuelve a reservar');
select isnt((select deadline_at from public.job_runs where job_id = '10000000-0000-4000-8000-000000000001'), null,
            'el despacho fija un plazo');

select public.set_job_output_paths('10000000-0000-4000-8000-000000000001', 1,
  array['assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb']);

-- ---------------------------------------------------------------------------
-- Callback: progreso, intentos viejos, salida no autorizada, éxito
-- ---------------------------------------------------------------------------
select is(public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'running', 0.3, 'fitting') ->> 'result',
          'applied', 'callback running aplicado');
select is((select status::text || ':' || progress || ':' || stage from public.jobs
            where id = '10000000-0000-4000-8000-000000000001'), 'running:0.3:fitting', 'progreso guardado');
select is(public.complete_job('10000000-0000-4000-8000-000000000001', 0, 'running', 0.9) ->> 'result',
          'stale_attempt', 'se descarta el callback de un intento anterior');

select throws_ok(
  $$ select public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'succeeded', null, null,
       jsonb_build_object('avatar', pg_temp.avatar_json('a1000000-0000-4000-8000-000000000001',
                                     'aaaaaaaa-0000-4000-8000-000000000001',
                                     'storage://assets/bbbbbbbb-0000-4000-8000-000000000002/avatars/robado.glb')),
       null, 'avatar-0.1', now()) $$,
  '22023', null, 'el worker no puede apuntar a un fichero que no se le autorizó');

select throws_ok(
  $$ select public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'succeeded', null, null,
       jsonb_build_object('avatar', pg_temp.avatar_json('a1000000-0000-4000-8000-000000000001',
                                     'bbbbbbbb-0000-4000-8000-000000000002',
                                     'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb')),
       null, 'avatar-0.1', now()) $$,
  '22023', null, 'el avatar tiene que ser del dueño del job');

select is(public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'succeeded', null, null,
       jsonb_build_object('avatar', pg_temp.avatar_json('a1000000-0000-4000-8000-000000000001',
                                     'aaaaaaaa-0000-4000-8000-000000000001',
                                     'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb')),
       null, 'avatar-0.1', '2026-11-11T12:00:00Z') ->> 'result',
  'applied', 'callback succeeded aplicado');

select is((select glb_path from public.avatars where id = 'a1000000-0000-4000-8000-000000000001'),
          'assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb', 'avatar persistido con la RUTA, no la URL');
select is((select status::text from public.jobs where id = '10000000-0000-4000-8000-000000000001'), 'succeeded',
          'job succeeded');
select results_eq($$ select input_deleted_at, output ? 'input_deleted_at', fake from public.jobs
                      where id = '10000000-0000-4000-8000-000000000001' $$,
                  $$ values ('2026-11-11T12:00:00Z'::timestamptz, false, false) $$,
                  'jobs.input_deleted_at lo anota la API con el borrado real; no va en la salida del worker');
select is((select body_model::text || ':' || jsonb_array_length(shape -> 'params') from public.avatars
            where id = 'a1000000-0000-4000-8000-000000000001'),
          'mhr:10', 'el avatar guarda el modelo corporal y un vector de forma opaco');
select is(public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'failed', null, null, null,
          '{"code":"internal","message":"x","retryable":false}') ->> 'result',
          'already_terminal', 'un job terminado no cambia (idempotencia)');
select throws_ok($$ select public.complete_job(gen_random_uuid(), 1, 'running') $$, 'P0002', null,
                 'job inexistente');

-- ---------------------------------------------------------------------------
-- Prenda: fallo y éxito respetando las correcciones del usuario
-- ---------------------------------------------------------------------------
insert into public.garments (id, user_id, category, name, user_corrected_fields) values
  ('90000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'jeans', 'Mis vaqueros',
   array['name', 'category']);
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'garment',
   '{"garment_id":"90000000-0000-4000-8000-000000000001","image_paths":["raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/g1.jpg"]}',
   1, 'running');
insert into public.job_runs (job_id, input_paths, output_paths, dispatched_at) values
  ('10000000-0000-4000-8000-000000000002', array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/g1.jpg'],
   array['assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.glb',
         'assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.png',
         'assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.json'], now());

select is(public.complete_job('10000000-0000-4000-8000-000000000002', 1, 'succeeded', null, null,
  jsonb_build_object('garment', jsonb_build_object(
      'id', '90000000-0000-4000-8000-000000000001', 'user_id', 'aaaaaaaa-0000-4000-8000-000000000001',
      'status', 'ready', 'category', 'pants', 'name', 'Pantalón azul', 'attributes', '{"pattern":"solid"}'::jsonb,
      'colors', '[{"lab":{"l":30,"a":0,"b":-20},"hex":"#223355","proportion":1}]'::jsonb,
      'design_fit', 'slim', 'size_label', '32', 'level', 1,
      'measurements', '[{"size_label":"32","zones":{"waist":82,"inseam":80},"source":"estimated"}]'::jsonb,
      'image_url', 'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.png',
      'glb_url', 'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.glb',
      'pipeline_version', 'garment-0.1', 'sewing_pattern_url', 'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.json',
      'sewing_pattern_format', 'garmentcode',
      'created_at', '2026-11-11T10:00:00Z', 'updated_at', '2026-11-11T10:00:00Z'),
    'embedding', jsonb_build_object('model', 'test-clip',
                                    'vector', (select jsonb_agg(0.5) from generate_series(1, 512)))),
  null, 'garment-0.1', now(), true) ->> 'result', 'applied', 'callback de prenda aplicado');
select results_eq(
  $$ select g.sewing_pattern_path, g.sewing_pattern_format::text, g.embedding_model,
            extensions.vector_dims(g.embedding), j.fake, j.output ? 'embedding'
       from public.garments g, public.jobs j
      where g.id = '90000000-0000-4000-8000-000000000001' and j.id = '10000000-0000-4000-8000-000000000002' $$,
  $$ values ('assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.json', 'garmentcode', 'test-clip', 512, true, false) $$,
  'patrón de costura y embedding guardados; jobs.fake anotado; el embedding no se queda en jobs.output');

select results_eq(
  $$ select status::text, category::text, name, design_fit::text from public.garments
      where id = '90000000-0000-4000-8000-000000000001' $$,
  $$ values ('ready', 'jeans', 'Mis vaqueros', 'slim') $$,
  'la prenda queda ready; el pipeline no pisa nombre ni categoría corregidos');
select is((select zones from public.garment_measurements where garment_id = '90000000-0000-4000-8000-000000000001'),
          '{"waist":82,"inseam":80}'::jsonb, 'medidas de la prenda guardadas');
select is((select jsonb_array_length(measurements) from public.garments_with_measurements
            where id = '90000000-0000-4000-8000-000000000001'), 1, 'la vista reconstruye Garment.measurements');

insert into public.garments (id, user_id) values ('90000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'garment',
   '{"garment_id":"90000000-0000-4000-8000-000000000002","image_paths":["raw-uploads/x/y.jpg"]}', 1, 'running');
insert into public.job_runs (job_id, input_paths) values ('10000000-0000-4000-8000-000000000003', array['raw-uploads/x/y.jpg']);
select public.complete_job('10000000-0000-4000-8000-000000000003', 1, 'failed', null, null, null,
  '{"code":"garment_not_detected","message":"no garment","retryable":false}', 'garment-0.1', null);
select is((select status::text from public.garments where id = '90000000-0000-4000-8000-000000000002'), 'failed',
          'job de prenda fallido → prenda failed');

-- ---------------------------------------------------------------------------
-- Drapeado: caché y FitResult
-- ---------------------------------------------------------------------------
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'drape',
   '{"avatar_id":"a1000000-0000-4000-8000-000000000001","garment_id":"90000000-0000-4000-8000-000000000001","size_label":"32","pose":"a_pose","quality":"preview"}',
   1, 'running');
insert into public.job_runs (job_id, cache_key, output_paths) values
  ('10000000-0000-4000-8000-000000000004', 'sha256:abc', array['assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb']);

select throws_ok($$ select public.complete_job('10000000-0000-4000-8000-000000000004', 1, 'succeeded', null, null,
  '{"glb_url":"storage://assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb","cache_key":"sha256:otra","cache_hit":false}',
  null, 'drape-0.1') $$, '22023', null, 'la cache_key la decide la API, no el worker');

select throws_ok($$ select public.complete_job('10000000-0000-4000-8000-000000000004', 1, 'succeeded', null, null,
  '{"glb_url":"storage://assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb","cache_key":"sha256:abc","cache_hit":false,
    "fit_result":{"id":"f0000000-0000-4000-8000-000000000009","user_id":"bbbbbbbb-0000-4000-8000-000000000002",
    "avatar_id":"a1000000-0000-4000-8000-000000000001","garment_id":"90000000-0000-4000-8000-000000000001"}}',
  null, 'drape-0.1') $$, '22023', null, 'el FitResult tiene que ser del dueño del job');

select is(public.complete_job('10000000-0000-4000-8000-000000000004', 1, 'succeeded', null, null,
  '{"glb_url":"storage://assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb","cache_key":"sha256:abc","cache_hit":false,
    "fit_result":{"id":"f0000000-0000-4000-8000-000000000001","user_id":"aaaaaaaa-0000-4000-8000-000000000001","avatar_id":"a1000000-0000-4000-8000-000000000001",
    "garment_id":"90000000-0000-4000-8000-000000000001","size_label":"32",
    "zones":[{"zone":"waist","body_cm":80,"garment_cm":82,"ease_cm":2,"verdict":"snug"}],
    "verdict":"fits","effective_fit":"slim","matches_design_fit":true,"score":0.9,"method":"simulated",
    "confidence":0.7,"created_at":"2026-11-11T10:00:00Z"}}',
  null, 'drape-0.1') ->> 'result', 'applied', 'callback de drapeado aplicado');
select results_eq($$ select glb_path, fit_result_id, simulator_version from public.drape_cache where cache_key = 'sha256:abc' $$,
                  $$ values ('assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb',
                             'f0000000-0000-4000-8000-000000000001'::uuid, 'drape-0.1') $$,
                  'drape_cache y fit_results guardados');
select is((select user_id from public.fit_results where id = 'f0000000-0000-4000-8000-000000000001'),
          'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'fit_results.user_id = dueño del job');
select is((select input_deleted_at from public.jobs where id = '10000000-0000-4000-8000-000000000004'), null,
          'un drapeado no tiene fotos: input_deleted_at queda nulo');

-- ---------------------------------------------------------------------------
-- Reintentos y plazos (pg_cron)
-- ---------------------------------------------------------------------------
insert into public.jobs (id, user_id, type, input, attempts, status, started_at) values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'color', '{}', 1, 'running', now()),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'color', '{}', 3, 'running', now()),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'color', '{}', 0, 'queued', null),
  ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'color', '{}', 0, 'queued', null);
update public.jobs set created_at = now() - interval '2 hours' where id = '20000000-0000-4000-8000-000000000003';
insert into public.job_runs (job_id, dispatched_at, deadline_at, input_paths) values
  ('20000000-0000-4000-8000-000000000001', now() - interval '20 minutes', now() - interval '1 minute', '{}'),
  ('20000000-0000-4000-8000-000000000002', now() - interval '20 minutes', now() - interval '1 minute',
   array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/s.jpg']),
  ('20000000-0000-4000-8000-000000000003', null, null, '{}'),
  ('20000000-0000-4000-8000-000000000004', null, null, '{}');

select is(public.reap_stale_jobs(), '{"requeued": 1, "timed_out": 1, "abandoned": 1}'::jsonb, 'reaper: recuentos');
select results_eq($$ select status::text, attempts from public.jobs where id = '20000000-0000-4000-8000-000000000001' $$,
                  $$ values ('queued', 1) $$, 'plazo vencido con intentos libres → vuelve a la cola');
select is((select dispatched_at from public.job_runs where job_id = '20000000-0000-4000-8000-000000000001'), null,
          'y queda disponible para volver a despacharse');
select results_eq($$ select status::text, error ->> 'code' from public.jobs where id = '20000000-0000-4000-8000-000000000002' $$,
                  $$ values ('failed', 'timeout') $$, 'tercer intento vencido → failed/timeout');
select results_eq($$ select status::text, error ->> 'code' from public.jobs where id = '20000000-0000-4000-8000-000000000003' $$,
                  $$ values ('failed', 'invalid_input') $$, 'fotos nunca subidas en 60 min → failed/invalid_input');
select is((select status::text from public.jobs where id = '20000000-0000-4000-8000-000000000004'), 'queued',
          'un job recién creado sigue en cola');

-- ---------------------------------------------------------------------------
-- Borrado de fotos: qué encuentra el barrido
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select job_id from public.jobs_with_pending_input_deletion() order by job_id $$,
  $$ values ('10000000-0000-4000-8000-000000000003'::uuid), ('20000000-0000-4000-8000-000000000002'::uuid) $$,
  'jobs terminados con fotos sin borrar (fallo sin borrado y timeout)');
select is(public.mark_job_inputs_deleted(array['20000000-0000-4000-8000-000000000002'::uuid]), 1, 'se anotan como borradas');

insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('raw-uploads', 'aaaaaaaa-0000-4000-8000-000000000001/vieja.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '61 minutes'),
  ('raw-uploads', 'aaaaaaaa-0000-4000-8000-000000000001/nueva.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '5 minutes');
select results_eq($$ select name from public.expired_raw_uploads() $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001/vieja.jpg') $$,
                  'el barrido encuentra solo las fotos de más de 60 minutos');

insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('assets', 'aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb', null, now() - interval '2 days'),
  ('assets', 'aaaaaaaa-0000-4000-8000-000000000001/avatars/huerfano.glb', null, now() - interval '2 days'),
  ('assets', 'catalog/garments/x.glb', null, now() - interval '2 days');
select results_eq($$ select name from public.orphaned_assets() $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001/avatars/huerfano.glb') $$,
                  'GC de assets: solo lo no referenciado y nunca el catálogo');

-- ---------------------------------------------------------------------------
-- Retirada del consentimiento de escaneo corporal
-- ---------------------------------------------------------------------------
insert into public.jobs (id, user_id, type, input, status) values
  ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'avatar',
   '{"consent_id":"c0000000-0000-4000-8000-00000000000a"}', 'queued');
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
update public.consents set withdrawn_at = now() where id = 'c0000000-0000-4000-8000-00000000000a';
select pg_temp.logout();
select is((select count(*) from public.avatars where user_id = 'aaaaaaaa-0000-4000-8000-000000000001')::int, 0,
          'retirar el consentimiento borra los avatares obtenidos de fotos');
select is((select count(*) from public.drape_cache where user_id = 'aaaaaaaa-0000-4000-8000-000000000001')::int, 0,
          '… y en cascada sus drapeados');
select is((select count(*) from public.fit_results where avatar_id = 'a1000000-0000-4000-8000-000000000001')::int, 0,
          '… y sus resultados de fit');
select is((select status::text from public.jobs where id = '30000000-0000-4000-8000-000000000001'), 'canceled',
          '… y cancela los jobs de avatar pendientes');
select results_eq($$ select name from public.orphaned_assets() order by name $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001/avatars/huerfano.glb'),
                            ('aaaaaaaa-0000-4000-8000-000000000001/avatars/j1-a1.glb') $$,
                  'el GLB del avatar borrado pasa a huérfano y lo limpiará el GC');

-- ---------------------------------------------------------------------------
-- Borrado de cuenta: listado de ficheros y cascada desde auth.users
-- ---------------------------------------------------------------------------
select is((select count(*) from public.user_storage_objects('aaaaaaaa-0000-4000-8000-000000000001'))::int, 5,
          'user_storage_objects lista todos los ficheros del usuario (raw-uploads y assets)');

insert into public.outfits (user_id, items) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '[{"garment_id":"90000000-0000-4000-8000-000000000001","size_label":"32","layer":0}]');
insert into public.user_fit_preferences (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001');
delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is((
  select (select count(*) from public.profiles where id = u) + (select count(*) from public.consents where user_id = u)
       + (select count(*) from public.avatars where user_id = u) + (select count(*) from public.color_profiles where user_id = u)
       + (select count(*) from public.garments where user_id = u) + (select count(*) from public.outfits where user_id = u)
       + (select count(*) from public.user_fit_preferences where user_id = u)
       + (select count(*) from public.drape_cache where user_id = u) + (select count(*) from public.jobs where user_id = u)
       + (select count(*) from public.job_runs r where r.job_id::text like '10000000-%')
       + (select count(*) from public.garment_measurements where garment_id = '90000000-0000-4000-8000-000000000001')
  from (select 'aaaaaaaa-0000-4000-8000-000000000001'::uuid as u) s)::int,
  0, 'borrar el usuario de Auth elimina en cascada todas sus filas');
select is((select count(*) from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002')::int, 1,
          'y no toca a otros usuarios');

select * from finish();
rollback;
