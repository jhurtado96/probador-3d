-- RLS: cada usuario solo ve lo suyo; store_products y el catálogo son públicos;
-- la app no puede escribir lo que produce el pipeline.
begin;
\ir helpers/setup.psql
select plan(52);

-- ---------------------------------------------------------------------------
-- Datos: usuarios A y B con una fila en cada tabla (insertadas como postgres)
-- ---------------------------------------------------------------------------
select pg_temp.create_user('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local');
select pg_temp.create_user('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

select is((select count(*) from public.profiles
            where id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'))::int,
          2, 'el alta en Auth crea el perfil');

insert into public.consents (id, user_id, purpose, text_version) values
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'body_scan', 'v1'),
  ('c0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'body_scan', 'v1');

insert into public.avatars (id, user_id, body_model, model_version, shape, measurements, measurements_source,
                            glb_path, pose, shape_hash, confidence)
select (a ->> 'id')::uuid, (a ->> 'user_id')::uuid, 'mhr', 'v', a -> 'shape', a -> 'measurements', 'photo',
       'assets/' || (a ->> 'user_id') || '/avatars/x.glb', 'a_pose', 'h', 0.9
  from (values (pg_temp.avatar_json('a1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'x')),
               (pg_temp.avatar_json('a1000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'x'))) v(a);

insert into public.color_profiles (user_id, season, undertone, value, intensity, contrast, scores, skin_lab,
                                   palettes, metal, confidence, white_balanced, pipeline_version)
select u, 'soft_summer', 'cool', 'medium', 'soft', 'low',
       '{"undertone":-0.4,"value":0.5,"intensity":0.3,"contrast":0.2}', '{"l":60,"a":12,"b":14}',
       '{"best":["#AABBCC"],"neutrals":[],"accents":[],"avoid":[]}', 'silver', 0.7, true, 'color-0.1'
  from (values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid), ('bbbbbbbb-0000-4000-8000-000000000002'::uuid)) v(u);

insert into public.store_products (id, network, merchant, external_id, title, category, affiliate_url, image_urls, price)
values ('50000000-0000-4000-8000-000000000001', 'awin', 'shop', 'ext-1', 'Camiseta', 'tshirt',
        'https://shop.example/p/1', array['https://shop.example/p/1.jpg'], '{"amount": 19.99, "currency": "EUR"}');

insert into public.garments (id, user_id, status, category, colors, design_fit, image_path, pipeline_version) values
  ('90000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'ready', 'tshirt',
   '[{"lab":{"l":50,"a":0,"b":0},"hex":"#777777","proportion":1}]', 'regular', 'assets/a/g.png', 'g-0.1'),
  ('90000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'ready', 'tshirt',
   '[{"lab":{"l":50,"a":0,"b":0},"hex":"#777777","proportion":1}]', 'regular', 'assets/b/g.png', 'g-0.1'),
  ('90000000-0000-4000-8000-0000000000cc', null, 'ready', 'tshirt',
   '[{"lab":{"l":50,"a":0,"b":0},"hex":"#777777","proportion":1}]', 'regular', 'assets/catalog/g.png', 'g-0.1');

insert into public.garment_measurements (garment_id, size_label, zones, source) values
  ('90000000-0000-4000-8000-00000000000a', 'M', '{"chest": 104}', 'manual'),
  ('90000000-0000-4000-8000-00000000000b', 'M', '{"chest": 104}', 'manual'),
  ('90000000-0000-4000-8000-0000000000cc', 'M', '{"chest": 104}', 'brand_size_chart');

insert into public.fit_results (user_id, avatar_id, garment_id, size_label, zones, verdict, effective_fit,
                                matches_design_fit, score, method, confidence)
select (select user_id from public.avatars where id = av), av, g, 'M', '[{"zone":"chest","body_cm":96,"garment_cm":104,"ease_cm":8,"verdict":"ideal"}]',
       'fits', 'regular', true, 0.8, 'size_chart', 0.6
  from (values ('a1000000-0000-4000-8000-00000000000a'::uuid, '90000000-0000-4000-8000-00000000000a'::uuid),
               ('a1000000-0000-4000-8000-00000000000b'::uuid, '90000000-0000-4000-8000-00000000000b'::uuid)) v(av, g);

insert into public.user_fit_preferences (user_id, default_fit) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'slim'), ('bbbbbbbb-0000-4000-8000-000000000002', 'oversize');

insert into public.outfits (user_id, avatar_id, items) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000000a',
   '[{"garment_id":"90000000-0000-4000-8000-00000000000a","size_label":"M","layer":0}]'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-00000000000b',
   '[{"garment_id":"90000000-0000-4000-8000-00000000000b","size_label":"M","layer":0}]');

insert into public.drape_cache (user_id, cache_key, avatar_id, garment_id, size_label, pose, quality, shape_hash,
                                simulator_version, glb_path)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'k', 'a1000000-0000-4000-8000-00000000000a',
        '90000000-0000-4000-8000-00000000000a', 'M', 'a_pose', 'preview', 'h', 's', 'assets/a/d.glb'),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'k', 'a1000000-0000-4000-8000-00000000000b',
        '90000000-0000-4000-8000-00000000000b', 'M', 'a_pose', 'preview', 'h', 's', 'assets/b/d.glb');

insert into public.jobs (id, user_id, type, input) values
  ('10000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'drape', '{}'),
  ('10000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'drape', '{}');
insert into public.job_runs (job_id) values ('10000000-0000-4000-8000-00000000000a'), ('10000000-0000-4000-8000-00000000000b');

insert into storage.objects (bucket_id, name, owner_id) values
  ('assets', 'aaaaaaaa-0000-4000-8000-000000000001/avatars/x.glb', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('assets', 'bbbbbbbb-0000-4000-8000-000000000002/avatars/x.glb', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('assets', 'catalog/garments/g.glb', null),
  ('raw-uploads', 'aaaaaaaa-0000-4000-8000-000000000001/photo.jpg', 'aaaaaaaa-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'RLS activado en todas las tablas de public');

select is((select public from storage.buckets where id = 'raw-uploads'), false, 'raw-uploads es privado');
select is((select public from storage.buckets where id = 'assets'), false, 'assets es privado');

-- ---------------------------------------------------------------------------
-- Usuario A: solo ve lo suyo
-- ---------------------------------------------------------------------------
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');

select results_eq($$ select id from public.profiles $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'profiles: solo el propio');
select results_eq($$ select user_id from public.consents $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'consents: solo los propios');
select results_eq($$ select user_id from public.avatars $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'avatars: solo los propios');
select results_eq($$ select user_id from public.color_profiles $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'color_profiles: solo los propios');
select set_eq($$ select id from public.garments $$,
              $$ values ('90000000-0000-4000-8000-00000000000a'::uuid), ('90000000-0000-4000-8000-0000000000cc'::uuid) $$,
              'garments: los propios y el catálogo, no los de B');
select is((select count(*) from public.garment_measurements)::int, 2, 'garment_measurements: propias + catálogo');
select is((select count(*) from public.garments_with_measurements)::int, 2, 'la vista respeta el RLS');
select is((select count(*) from public.fit_results)::int, 1, 'fit_results: solo los propios');
select results_eq($$ select user_id from public.user_fit_preferences $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'user_fit_preferences: solo las propias');
select results_eq($$ select user_id from public.outfits $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'outfits: solo los propios');
select results_eq($$ select user_id from public.drape_cache $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'drape_cache: solo la propia');
select results_eq($$ select user_id from public.jobs $$,
                  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$, 'jobs: solo los propios');
select is((select count(*) from public.store_products)::int, 1, 'store_products: lectura para autenticados');
select throws_ok($$ select * from public.job_runs $$, '42501', null, 'job_runs: invisible para la app');

-- Storage
select set_eq($$ select name from storage.objects $$,
              $$ values ('aaaaaaaa-0000-4000-8000-000000000001/avatars/x.glb'), ('catalog/garments/g.glb') $$,
              'storage: sus assets y el catálogo; ni assets de B ni raw-uploads (ni las propias)');

-- Escrituras prohibidas
select throws_ok($$ insert into public.avatars (user_id, body_model, model_version, shape, measurements,
                    measurements_source, glb_path, pose, shape_hash, confidence)
                    select user_id, body_model, model_version, shape, measurements, measurements_source, glb_path,
                           pose, shape_hash, confidence from public.avatars limit 1 $$,
                 '42501', null, 'la app no inserta avatares (los crea el pipeline)');
select throws_ok($$ insert into public.jobs (user_id, type, input)
                    values ('aaaaaaaa-0000-4000-8000-000000000001', 'avatar', '{}') $$,
                 '42501', null, 'la app no crea jobs directamente (Edge Function create-job)');
select throws_ok($$ update public.jobs set status = 'succeeded' $$, '42501', null, 'la app no cambia jobs');
select throws_ok($$ update public.avatars set confidence = 1 $$, '42501', null,
                 'avatars: solo measurements_override es editable');
select lives_ok($$ update public.avatars set measurements_override = '{"waist_cm": 81}' $$,
                'avatars: corregir medidas (rectificación)');
select throws_ok($$ insert into public.consents (user_id, purpose, text_version)
                    values ('bbbbbbbb-0000-4000-8000-000000000002', 'analytics', 'v1') $$,
                 '42501', null, 'no puede otorgar consentimientos en nombre de otro');
select lives_ok($$ insert into public.consents (purpose, text_version) values ('analytics', 'v1') $$,
                'otorga su propio consentimiento (user_id = auth.uid() por defecto)');
select throws_ok($$ update public.consents set purpose = 'analytics' $$, '42501', null,
                 'consents: solo withdrawn_at es editable');
select throws_ok($$ delete from public.consents $$, '42501', null, 'consents: no se borran (prueba)');
select throws_ok($$ insert into public.garments (user_id, status, pipeline_version)
                    values ('bbbbbbbb-0000-4000-8000-000000000002', 'processing', 'p') $$,
                 '42501', null, 'garments: no crea prendas de otro');
select throws_ok($$ insert into public.garments (status, category, colors, design_fit, image_path, pipeline_version)
                    values ('ready', 'tshirt', '[{"hex":"#000000"}]', 'slim', 'assets/x.png', 'p') $$,
                 '42501', null, 'garments: la app solo crea prendas en processing');
select lives_ok($$ insert into public.garments (category) values ('jeans') $$,
                'garments: crea su prenda en processing');

-- Escrituras que no deben tocar filas ajenas (RLS filtra: 0 filas)
update public.garments set name = 'hack' where id = '90000000-0000-4000-8000-00000000000b';
update public.garments set name = 'hack' where id = '90000000-0000-4000-8000-0000000000cc';
delete from public.outfits where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
delete from public.avatars where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
update public.user_fit_preferences set default_fit = 'slim' where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select throws_ok($$ insert into public.outfits (avatar_id, items)
                    values ('a1000000-0000-4000-8000-00000000000b', '[{"garment_id":"90000000-0000-4000-8000-00000000000a","size_label":null,"layer":0}]') $$,
                 '42501', null, 'outfits: no se puede usar el avatar de otro');
select throws_ok($$ insert into public.garment_measurements (garment_id, size_label, zones, source)
                    values ('90000000-0000-4000-8000-00000000000b', 'L', '{}', 'manual') $$,
                 '42501', null, 'garment_measurements: no en prendas ajenas');
select throws_ok($$ select public.complete_job('10000000-0000-4000-8000-00000000000a', 1, 'running') $$,
                 '42501', null, 'la app no puede ejecutar complete_job');
select throws_ok($$ select * from public.user_storage_objects('bbbbbbbb-0000-4000-8000-000000000002') $$,
                 '42501', null, 'la app no puede listar ficheros de otros');
select throws_ok($$ select public.reap_stale_jobs() $$, '42501', null, 'la app no puede ejecutar el reaper');

-- Retirada de consentimiento: solo se puede retirar, no reactivar.
select lives_ok($$ update public.consents set withdrawn_at = now() where purpose = 'analytics' $$,
                'retira su consentimiento');
select results_eq($$ with u as (update public.consents set withdrawn_at = null where purpose = 'analytics' returning 1)
                     select count(*)::int from u $$,
                  $$ values (0) $$, 'un consentimiento retirado no se reactiva');

select pg_temp.logout();

-- Las escrituras de A sobre filas de B no tuvieron efecto
select is((select name from public.garments where id = '90000000-0000-4000-8000-00000000000b'), null,
          'A no modificó la prenda de B');
select is((select name from public.garments where id = '90000000-0000-4000-8000-0000000000cc'), null,
          'A no modificó el catálogo');
select is((select count(*) from public.outfits where user_id = 'bbbbbbbb-0000-4000-8000-000000000002')::int, 1,
          'A no borró outfits de B');
select is((select count(*) from public.avatars where user_id = 'bbbbbbbb-0000-4000-8000-000000000002')::int, 1,
          'A no borró avatares de B');
select is((select default_fit::text from public.user_fit_preferences
            where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 'oversize', 'A no cambió preferencias de B');

-- ---------------------------------------------------------------------------
-- Usuario B: simétrico (comprobación rápida)
-- ---------------------------------------------------------------------------
select pg_temp.login_as('bbbbbbbb-0000-4000-8000-000000000002');
select results_eq($$ select user_id from public.avatars $$,
                  $$ values ('bbbbbbbb-0000-4000-8000-000000000002'::uuid) $$, 'B: solo sus avatares');
select is((select count(*) from public.consents)::int, 1, 'B: solo sus consentimientos');
select pg_temp.logout();

-- ---------------------------------------------------------------------------
-- Anónimo: solo catálogo
-- ---------------------------------------------------------------------------
select pg_temp.login_anon();
select is((select count(*) from public.store_products)::int, 1, 'anon: store_products es de lectura pública');
select results_eq($$ select id from public.garments $$,
                  $$ values ('90000000-0000-4000-8000-0000000000cc'::uuid) $$, 'anon: solo prendas de catálogo');
select throws_ok($$ select * from public.avatars $$, '42501', null, 'anon: sin acceso a avatars');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon: sin acceso a profiles');
select throws_ok($$ select * from public.jobs $$, '42501', null, 'anon: sin acceso a jobs');
select throws_ok($$ insert into public.store_products (network, merchant, external_id, title, category, affiliate_url,
                    image_urls, price) values ('awin','m','e','t','tshirt','https://x',array['https://x'],
                    '{"amount":1,"currency":"EUR"}') $$, '42501', null, 'anon: no escribe en store_products');
select results_eq($$ select name from storage.objects $$, $$ values ('catalog/garments/g.glb') $$,
                  'anon: en Storage solo el catálogo');
select pg_temp.logout();

select * from finish();
rollback;
