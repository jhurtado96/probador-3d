-- Arreglos de la revisión de la fase 0 (docs/reviews/2026-11-11-revision-fase0.md):
-- A1 (jobs sin copias de datos personales), A2 (retirada de colorimetría),
-- A3/B4 (entrega única del despacho), M1 (prueba del consentimiento),
-- M2/B5 (subidas revocables), M4 (caché de drapeado), M6 (alertas), B1, B2, B6, B8, B9.
begin;
\ir helpers/setup.psql
select plan(68);

select pg_temp.create_user('aaaaaaaa-0000-4000-8000-000000000001', 'Ana.Prueba@Test.Local');
select pg_temp.create_user('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

create or replace function pg_temp.color_json(p_id uuid, p_user uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'user_id', p_user, 'season', 'soft_summer', 'undertone', 'cool', 'value', 'medium',
    'intensity', 'soft', 'contrast', 'low',
    'scores', '{"undertone":0.1,"value":0.5,"intensity":0.3,"contrast":0.2}'::jsonb,
    'skin_lab', '{"l":62.1,"a":14.3,"b":18.9}'::jsonb, 'eye_lab', '{"l":30,"a":5,"b":10}'::jsonb,
    'hair_lab', '{"l":25,"a":4,"b":8}'::jsonb, 'ita', 21.7, 'skin_hue_deg', 52.8,
    'palettes', '{"best":["#112233"],"neutrals":[],"accents":[],"avoid":[]}'::jsonb, 'metal', 'silver',
    'confidence', 0.7, 'white_balanced', true, 'pipeline_version', 'color-0.1',
    'created_at', '2026-11-11T10:00:00Z', 'updated_at', '2026-11-11T10:00:00Z');
$$;

-- Jobs que contienen algún dato personal fuera de sus tablas.
create or replace function pg_temp.personal_data_in_jobs(p_user uuid)
returns bigint language sql as $$
  select count(*) from public.jobs
   where user_id = p_user and status in ('succeeded', 'failed', 'canceled')
     and (input::text ~ '(height_cm|weight_kg|gender|photo_path|selfie_path|image_paths|white_reference)'
          or coalesce(output::text, '') ~ '(measurements|shape|skin_lab|hair_lab|eye_lab|"ita"|skin_hue|glb_url|storage://)');
$$;

-- ===========================================================================
-- M1: el servidor fija fecha y versión del consentimiento
-- ===========================================================================
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
select throws_ok($$ insert into public.consents (purpose, granted_at) values ('body_scan', '2020-01-01') $$,
                 '42501', null, 'M1: la app no puede fijar granted_at');
select throws_ok($$ insert into public.consents (purpose, created_at) values ('body_scan', '2020-01-01') $$,
                 '42501', null, 'M1: ni created_at');
select throws_ok($$ insert into public.consents (purpose, text_version) values ('body_scan', 'lo-que-sea') $$,
                 '23514', null, 'M1: ni una versión del texto que no es la vigente');
select lives_ok($$ insert into public.consents (purpose) values ('body_scan'), ('color_analysis') $$,
                'M1: la app solo envía el tratamiento');
select lives_ok($$ insert into public.consents (purpose, text_version) values ('analytics', 'analytics-2026-11-draft') $$,
                'M1: o el tratamiento y la versión vigente que mostró');
select throws_ok($$ update public.consents set text_version = 'x' $$, '42501', null,
                 'M1: la versión aceptada no se reescribe');
select pg_temp.logout();

select results_eq(
  $$ select purpose::text, text_version, granted_at = now(), created_at = now() from public.consents
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' order by purpose $$,
  $$ values ('analytics', 'analytics-2026-11-draft', true, true),
            ('body_scan', 'body_scan-2026-11-draft', true, true),
            ('color_analysis', 'color_analysis-2026-11-draft', true, true) $$,
  'M1: versión vigente de consent_texts y hora del servidor');
select throws_ok($$ update public.consents set granted_at = '2020-01-01'
                     where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
                 '42501', null, 'M1: ni service_role ni postgres reescriben la fecha de concesión');
select throws_ok($$ update public.consent_texts set body = 'otro' $$, '42501', null,
                 'M1: un texto publicado no se edita');
select throws_ok($$ delete from public.consent_texts $$, '42501', null, 'M1: ni se borra');
select is((select sha256 from public.consent_texts where version = 'body_scan-2026-11-draft'),
          (select encode(extensions.digest(body, 'sha256'), 'hex') from public.consent_texts
            where version = 'body_scan-2026-11-draft'),
          'M1: cada texto lleva su SHA-256');
select pg_temp.login_anon();
select ok((select count(*) > 0 from public.consent_texts), 'M1: los textos son públicos (la app los muestra)');
select pg_temp.logout();

-- ===========================================================================
-- A1: jobs.input y jobs.output sin datos personales al terminar
-- ===========================================================================
-- Avatar
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'avatar',
   jsonb_build_object('photo_path', 'raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/p.jpg', 'height_cm', 171,
                      'weight_kg', 70, 'gender', 'female',
                      'consent_id', (select id from public.consents where purpose = 'body_scan'
                                       and user_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
   1, 'running');
insert into public.job_runs (job_id, input_paths, output_paths, dispatched_at, deadline_at) values
  ('10000000-0000-4000-8000-000000000001', array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/p.jpg'],
   array['assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/a.glb'], now(), now() + interval '10 minutes');
select is((select input ->> 'height_cm' from public.jobs where id = '10000000-0000-4000-8000-000000000001'), '171',
          'A1: mientras el job está en curso conserva su entrada (hace falta para despachar)');

select throws_ok(
  $$ select public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'succeeded', null, null,
       jsonb_build_object('avatar', pg_temp.avatar_json('a1000000-0000-4000-8000-000000000001',
         'aaaaaaaa-0000-4000-8000-000000000001', 'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/a.glb')
         || '{"body_model":"smplx"}'), null, 'avatar-0.1', now()) $$,
  '22023', null, 'B9: un avatar SMPL-X se rechaza (sin licencia comercial)');

select is(public.complete_job('10000000-0000-4000-8000-000000000001', 1, 'succeeded', null, null,
       jsonb_build_object('avatar', pg_temp.avatar_json('a1000000-0000-4000-8000-000000000001',
         'aaaaaaaa-0000-4000-8000-000000000001', 'storage://assets/aaaaaaaa-0000-4000-8000-000000000001/avatars/a.glb')),
       null, 'avatar-0.1', now()) ->> 'result', 'applied', 'A1: callback de avatar aplicado');
select is((select output from public.jobs where id = '10000000-0000-4000-8000-000000000001'),
          '{"avatar_id": "a1000000-0000-4000-8000-000000000001"}'::jsonb,
          'A1: output del avatar = solo su id (sin medidas ni forma)');
select is((select input from public.jobs where id = '10000000-0000-4000-8000-000000000001'),
          jsonb_build_object('consent_id', (select id from public.consents where purpose = 'body_scan'
                                              and user_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
          'A1: input del avatar terminado = solo consent_id (sin altura, peso, género ni ruta de la foto)');

-- Colorimetría
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'color',
   jsonb_build_object('selfie_path', 'raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/s.jpg',
                      'white_reference', 'paper',
                      'consent_id', (select id from public.consents where purpose = 'color_analysis'
                                       and user_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
   1, 'running');
insert into public.job_runs (job_id, input_paths) values
  ('10000000-0000-4000-8000-000000000002', array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/s.jpg']);
select public.complete_job('10000000-0000-4000-8000-000000000002', 1, 'succeeded', null, null,
  jsonb_build_object('color_profile', pg_temp.color_json('c1000000-0000-4000-8000-000000000001',
                                                          'aaaaaaaa-0000-4000-8000-000000000001')),
  null, 'color-0.1', now());
select is((select output from public.jobs where id = '10000000-0000-4000-8000-000000000002'),
          '{"color_profile_id": "c1000000-0000-4000-8000-000000000001"}'::jsonb,
          'A1: output de colorimetría = solo el id del perfil (sin LAB ni ITA)');

-- Prenda y drapeado
insert into public.garments (id, user_id) values
  ('90000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');
update public.garments set status = 'ready', category = 'shirt', design_fit = 'regular',
       image_path = 'assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.png', colors = '[{"hex":"#ffffff"}]',
       glb_path = 'assets/aaaaaaaa-0000-4000-8000-000000000001/garments/g.glb'
 where id = '90000000-0000-4000-8000-000000000001';
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'drape',
   '{"avatar_id":"a1000000-0000-4000-8000-000000000001","garment_id":"90000000-0000-4000-8000-000000000001","size_label":"M","pose":"a_pose","quality":"preview"}',
   1, 'running');
insert into public.job_runs (job_id, cache_key, output_paths) values
  ('10000000-0000-4000-8000-000000000003', 'sha256:k1', array['assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb']);
select public.complete_job('10000000-0000-4000-8000-000000000003', 1, 'succeeded', null, null,
  '{"glb_url":"storage://assets/aaaaaaaa-0000-4000-8000-000000000001/drapes/d.glb","cache_key":"sha256:k1","cache_hit":false,
    "fit_result":{"id":"f0000000-0000-4000-8000-000000000001","user_id":"aaaaaaaa-0000-4000-8000-000000000001",
    "avatar_id":"a1000000-0000-4000-8000-000000000001","garment_id":"90000000-0000-4000-8000-000000000001","size_label":"M",
    "zones":[{"zone":"chest","body_cm":96,"garment_cm":104,"ease_cm":8,"verdict":"ideal"}],
    "verdict":"fits","effective_fit":"regular","matches_design_fit":true,"score":0.9,"method":"simulated",
    "confidence":0.7,"created_at":"2026-11-11T10:00:00Z"}}', null, 'drape-0.1');
select is((select output from public.jobs where id = '10000000-0000-4000-8000-000000000003'),
          jsonb_build_object('drape_cache_id', (select id from public.drape_cache where cache_key = 'sha256:k1'),
                             'fit_result_id', 'f0000000-0000-4000-8000-000000000001', 'cache_hit', false),
          'A1: output del drapeado = ids de drape_cache y fit_results (sin GLB, medidas ni holguras)');
select is((select input from public.jobs where id = '10000000-0000-4000-8000-000000000003'),
          '{"avatar_id":"a1000000-0000-4000-8000-000000000001","garment_id":"90000000-0000-4000-8000-000000000001"}'::jsonb,
          'A1: input del drapeado terminado = solo ids');

-- El trigger es la garantía, venga de donde venga la escritura.
insert into public.jobs (id, user_id, type, input, status, output, finished_at) values
  ('10000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'avatar',
   '{"height_cm":180,"weight_kg":90,"gender":"male","consent_id":"00000000-0000-4000-8000-000000000000"}', 'succeeded',
   '{"avatar_id":"a1000000-0000-4000-8000-000000000009","avatar":{"measurements":{"chest_cm":100}}}', now());
select is((select input::text || ' ' || output::text from public.jobs where id = '10000000-0000-4000-8000-000000000004'),
          '{"consent_id": "00000000-0000-4000-8000-000000000000"} {"avatar_id": "a1000000-0000-4000-8000-000000000009"}',
          'A1: cualquier INSERT/UPDATE de un job terminado queda reducido a ids');
insert into public.jobs (id, user_id, type, input, status, error, finished_at) values
  ('10000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'color',
   '{"selfie_path":"raw-uploads/x/s.jpg","white_reference":"none","consent_id":"00000000-0000-4000-8000-000000000000"}',
   'failed', '{"code":"no_face_detected","message":"x","retryable":false}', now());
select is(pg_temp.personal_data_in_jobs('aaaaaaaa-0000-4000-8000-000000000001'), 0::bigint,
          'A1: ningún job terminado guarda altura, peso, género, rutas, medidas, forma, LAB ni ITA');

-- ===========================================================================
-- M4: corregir medidas invalida la caché de drapeado
-- ===========================================================================
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok($$ update public.avatars set measurements_override = '{"waist_cm": 79}' $$,
                'M4: el usuario corrige la cintura');
select throws_ok($$ update public.avatars set measurements_override = '{"chest_cm": -40, "waist_cm": "abc"}' $$,
                 '23514', null, 'B2: measurements_override fuera de rango o no numérico se rechaza');
select throws_ok($$ update public.avatars set measurements_override = '{"x": 1}' $$,
                 '23514', null, 'B2: y con claves que no son de BodyMeasurements');
select throws_ok($$ update public.garments set status = 'failed' $$, '42501', null,
                 'B2: la app ya no cambia garments.status');
select throws_ok($$ update public.garments set size_label = repeat('x', 33) $$, '23514', null,
                 'B6: size_label tiene longitud máxima');
select pg_temp.logout();
select is((select count(*)::int from public.drape_cache where avatar_id = 'a1000000-0000-4000-8000-000000000001'), 0,
          'M4: la caché de drapeado de ese avatar se invalida');

-- ===========================================================================
-- A1 + A2: retirada de consentimientos y borrados llegan a jobs
-- ===========================================================================
-- Un avatar en curso que la retirada cancelará.
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('10000000-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'avatar',
   '{"photo_path":"raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/q.jpg","height_cm":171,"consent_id":"00000000-0000-4000-8000-000000000000"}',
   1, 'running');
insert into public.job_runs (job_id, input_paths) values
  ('10000000-0000-4000-8000-000000000006', array['raw-uploads/aaaaaaaa-0000-4000-8000-000000000001/q.jpg']);

-- El usuario corrige la estación a mano y después retira ambos consentimientos.
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
update public.color_profiles set season = 'deep_autumn', user_overridden = true;
update public.consents set withdrawn_at = now() where purpose in ('body_scan', 'color_analysis');
select pg_temp.logout();

select is((select count(*)::int from public.color_profiles where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
          'A2: retirar color_analysis borra el perfil de color también si se corrigió a mano');
select is((select count(*)::int from public.avatars where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
          'A1: retirar body_scan borra los avatares de foto');
select results_eq(
  $$ select status::text, input from public.jobs where id = '10000000-0000-4000-8000-000000000006' $$,
  $$ values ('canceled', '{"consent_id":"00000000-0000-4000-8000-000000000000"}'::jsonb) $$,
  'A1: el avatar en curso se cancela y su entrada se reduce a ids');
select is((select count(*)::int from public.jobs
            where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and type in ('avatar', 'color')
              and output is not null), 0,
          'A1: tras la retirada ningún job de avatar o color conserva salida');
select is((select input from public.jobs where id = '10000000-0000-4000-8000-000000000003'),
          '{"garment_id":"90000000-0000-4000-8000-000000000001"}'::jsonb,
          'A1: el drapeado sobre el avatar borrado pierde el avatar_id');
select is((select output from public.jobs where id = '10000000-0000-4000-8000-000000000003'), null,
          'A1: y su salida (fit y caché ya borrados)');
select is(pg_temp.personal_data_in_jobs('aaaaaaaa-0000-4000-8000-000000000001'), 0::bigint,
          'A1: tras la retirada no queda ninguna medida, forma ni color en jobs');

-- Borrar la prenda limpia sus jobs.
insert into public.jobs (id, user_id, type, input, status, output, finished_at) values
  ('10000000-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000001', 'garment',
   '{"garment_id":"90000000-0000-4000-8000-000000000001","image_paths":["raw-uploads/x/g.jpg"]}', 'succeeded',
   '{"garment_id":"90000000-0000-4000-8000-000000000001"}', now());
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
delete from public.garments where id = '90000000-0000-4000-8000-000000000001';
select pg_temp.logout();
select results_eq(
  $$ select input, output from public.jobs where id in ('10000000-0000-4000-8000-000000000007',
                                                         '10000000-0000-4000-8000-000000000003') $$,
  $$ values ('{}'::jsonb, null::jsonb), ('{}'::jsonb, null::jsonb) $$,
  'A1: borrar la prenda quita su id de los jobs de prenda y de drapeado');

-- Purga de jobs terminados a los 30 días, nunca antes de borrar sus fotos.
update public.jobs set finished_at = now() - interval '31 days'
 where id in ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006');
select is(public.purge_finished_jobs(), 1, 'A1: se purga el job terminado hace más de 30 días');
select is((select count(*)::int from public.jobs where id = '10000000-0000-4000-8000-000000000006'), 1,
          'A1: salvo si sus fotos aún no constan como borradas');
select is((select count(*)::int from cron.job where jobname = 'maintenance-daily'
            and command like '%purge_finished_jobs%'), 1, 'A1: la purga está programada en pg_cron');

-- ===========================================================================
-- M1: archivo con seudónimo del email, recalculable; B1
-- ===========================================================================
delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select count(*)::int from public.consent_records_archive
            where email_hash = encode(extensions.hmac('email:ana.prueba@test.local',
                                     (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'consent_pseudonym_secret'), 'sha256'), 'hex')),
          3, 'M1: el archivo guarda HMAC del email normalizado (no el email)');
select is((select count(*)::int from public.consent_archive_lookup(p_email => '  ANA.prueba@test.LOCAL ')), 3,
          'M1: quien reclama se encuentra por su email');
select is((select count(*)::int from public.consent_archive_lookup(p_user_id => 'aaaaaaaa-0000-4000-8000-000000000001')),
          3, 'M1: o por su user_id');
select is((select count(*)::int from public.consent_records_archive a
            where to_jsonb(a)::text ilike '%ana.prueba%'), 0, 'M1: el email en claro no se guarda');
select ok(not has_function_privilege('service_role', 'public.purge_consent_archive(interval)', 'execute'),
          'B1: service_role no puede ejecutar la purga del archivo');
select ok(not has_function_privilege('authenticated', 'public.consent_archive_lookup(text, uuid)', 'execute'),
          'M1: la búsqueda en el archivo no está al alcance de la app');

-- ===========================================================================
-- A3 / B4: el despacho se entrega una sola vez por intento
-- ===========================================================================
insert into public.jobs (id, user_id, type, input, attempts, status) values
  ('20000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'color',
   '{"selfie_path":"raw-uploads/bbbbbbbb-0000-4000-8000-000000000002/s.jpg","white_reference":"paper","consent_id":"00000000-0000-4000-8000-000000000000"}',
   0, 'queued');
insert into public.job_runs (job_id, input_paths) values
  ('20000000-0000-4000-8000-000000000001', array['raw-uploads/bbbbbbbb-0000-4000-8000-000000000002/s.jpg']);
select is_empty($$ select * from public.claim_job_dispatch_fetch('20000000-0000-4000-8000-000000000001', 1) $$,
                'A3: no se entrega el despacho de un job que no se ha despachado');

-- M2/B5: subidas a raw-uploads solo para jobs en cola (el guard se activa en el test).
set local probador.storage_guard = 'on';
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                   values ('raw-uploads', 'bbbbbbbb-0000-4000-8000-000000000002/s.jpg', null) $$,
                'M2: se admite la foto que espera un job en cola');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                    values ('raw-uploads', 'bbbbbbbb-0000-4000-8000-000000000002/otra.jpg', null) $$,
                 '42501', null, 'M2: se rechaza una foto que ningún job espera');

select results_eq($$ select attempt from public.claim_jobs_for_dispatch('20000000-0000-4000-8000-000000000001') $$,
                  $$ values (1) $$, 'A3: se reserva y despacha el intento 1');
select public.set_job_output_paths('20000000-0000-4000-8000-000000000001', 1,
  array['assets/bbbbbbbb-0000-4000-8000-000000000002/avatars/x.glb']);
select is_empty($$ select * from public.claim_job_dispatch_fetch('20000000-0000-4000-8000-000000000001', 2) $$,
                'A3: un intento que no es el vigente no recibe el despacho');
select results_eq($$ select attempt, input ->> 'white_reference' from public.claim_job_dispatch_fetch('20000000-0000-4000-8000-000000000001', 1) $$,
                  $$ values (1, 'paper') $$, 'A3: el contenedor obtiene el despacho del intento vigente');
select is_empty($$ select * from public.claim_job_dispatch_fetch('20000000-0000-4000-8000-000000000001', 1) $$,
                'B4: un aviso reenviado no vuelve a obtener el despacho (ni la URL de la foto)');

select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                    values ('raw-uploads', 'bbbbbbbb-0000-4000-8000-000000000002/s2.jpg', null) $$,
                 '42501', null, 'B5: cuando el job deja la cola, su URL de subida ya no sirve');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                   values ('assets', 'bbbbbbbb-0000-4000-8000-000000000002/avatars/x.glb', null) $$,
                'M2: el worker sube la salida autorizada de un job activo');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                   values ('assets', 'bbbbbbbb-0000-4000-8000-000000000002/outfits/p.png', null) $$,
                'M2: la app sube miniaturas de outfits');
select is(public.cancel_user_jobs('bbbbbbbb-0000-4000-8000-000000000002'), 1,
          'M2: la baja cancela antes los jobs en curso');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
                    values ('assets', 'bbbbbbbb-0000-4000-8000-000000000002/avatars/x2.glb', null) $$,
                 '42501', null, 'M2: tras la baja o la retirada, el worker ya no puede subir nada');
select is((select input ->> 'selfie_path' from public.jobs where id = '20000000-0000-4000-8000-000000000001'), null,
          'A1: el job cancelado por la baja también se minimiza');
reset probador.storage_guard;

-- ===========================================================================
-- B8: cuota atómica
-- ===========================================================================
select is((select count(*)::int from public.enqueue_job('bbbbbbbb-0000-4000-8000-000000000002', 'drape',
             '{"avatar_id":"a1000000-0000-4000-8000-00000000000b","garment_id":"90000000-0000-4000-8000-00000000000b","size_label":"M","pose":"a_pose","quality":"preview"}',
             '{}', 'sha256:q', 1)), 0,
          'B8: con 1 job en 24 h y límite 1, enqueue_job no inserta');
select is((select count(*)::int from public.enqueue_job('bbbbbbbb-0000-4000-8000-000000000002', 'drape',
             '{"avatar_id":"a1000000-0000-4000-8000-00000000000b","garment_id":"90000000-0000-4000-8000-00000000000b","size_label":"M","pose":"a_pose","quality":"preview"}',
             '{}', 'sha256:q', 2)), 1,
          'B8: con cuota disponible inserta el job');
select is((select cache_key from public.job_runs r join public.jobs j on j.id = r.job_id
            where j.user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and j.type = 'drape'), 'sha256:q',
          'B8: y su job_runs en la misma transacción');

-- ===========================================================================
-- M6: alertas consultables
-- ===========================================================================
insert into storage.objects (bucket_id, name, owner_id, created_at) values
  ('raw-uploads', 'bbbbbbbb-0000-4000-8000-000000000002/vieja.jpg', null, now() - interval '80 minutes');
select is((public.check_privacy_invariants() ->> 'raw_uploads_overdue')::int, 1,
          'M6: el watchdog detecta una foto con más de 75 minutos');
select is((select count(*)::int from public.ops_alerts where kind = 'raw_uploads_overdue' and resolved_at is null), 1,
          'M6: y deja una alerta abierta y consultable');
select ok(public.scans_paused(), 'M6: con la alerta abierta, los escaneos se pausan');
select is((select count(*)::int from public.ops_alerts where kind = 'maintenance_not_configured' and resolved_at is null),
          case when (select count(*) from vault.decrypted_secrets where name in ('project_url', 'maintenance_secret')) = 2
               then 0 else 1 end,
          'M6: la falta de configuración de maintenance también abre alerta');
update storage.objects set created_at = now() where bucket_id = 'raw-uploads' and name = 'bbbbbbbb-0000-4000-8000-000000000002/vieja.jpg';
select public.check_privacy_invariants();
select ok(not public.scans_paused(), 'M6: al desaparecer la condición la alerta se cierra sola');
select is((select count(*)::int from cron.job where jobname = 'privacy-watchdog'), 1,
          'M6: el watchdog está programado');
select pg_temp.login_as('bbbbbbbb-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.ops_alerts $$, '42501', null, 'M6: la app no ve las alertas');
select pg_temp.logout();

select * from finish();
rollback;
