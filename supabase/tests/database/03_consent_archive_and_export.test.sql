-- D6: archivo bloqueado y seudonimizado de consentimientos al borrar la cuenta,
-- con purga a los 3 años. D7: cuota de export-data.
begin;
\ir helpers/setup.psql
select plan(38);

-- ---------------------------------------------------------------------------
-- La tabla de archivo: exactamente los campos decididos, bloqueada
-- ---------------------------------------------------------------------------
select columns_are('public', 'consent_records_archive',
  array['user_hash', 'purpose', 'text_version', 'granted_at', 'withdrawn_at', 'archived_at'],
  'el archivo solo tiene hash, tratamiento, versión, concesión, retirada y fecha de archivo');
select hasnt_column('public', 'consent_records_archive', 'user_id', 'el archivo no tiene user_id');

select ok((select relrowsecurity from pg_class where oid = 'public.consent_records_archive'::regclass),
          'RLS activado en el archivo');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'consent_records_archive'),
          0, 'sin políticas RLS: nadie con RLS puede ver nada');
select ok(not has_table_privilege('anon', 'public.consent_records_archive', 'select,insert,update,delete,truncate'),
          'anon no tiene ningún privilegio sobre el archivo');
select ok(not has_table_privilege('authenticated', 'public.consent_records_archive', 'select,insert,update,delete,truncate'),
          'authenticated no tiene ningún privilegio sobre el archivo');
select ok(has_table_privilege('service_role', 'public.consent_records_archive', 'select'),
          'service_role puede leer el archivo');
select ok(not has_table_privilege('service_role', 'public.consent_records_archive', 'insert,update,delete,truncate'),
          'service_role no puede escribir ni borrar en el archivo');
select ok(obj_description('public.consent_records_archive'::regclass, 'pg_class') like '%art. 32 LOPDGDD%'
          and obj_description('public.consent_records_archive'::regclass, 'pg_class') like '%art. 7.1 RGPD%',
          'el comentario de la tabla cita el art. 32 LOPDGDD y el art. 7.1 RGPD');

-- ---------------------------------------------------------------------------
-- Datos: usuario A con un consentimiento retirado en vida y otro vigente; B intacto
-- ---------------------------------------------------------------------------
select pg_temp.create_user('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local');
select pg_temp.create_user('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local');

insert into public.consents (id, user_id, purpose, text_version, granted_at) values
  ('c0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'body_scan', 'body_scan-v1',
   now() - interval '10 days'),
  ('c0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'color_analysis', 'color-v2',
   now() - interval '5 days'),
  ('c0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002', 'body_scan', 'body_scan-v1',
   now() - interval '3 days');

-- Retirada en vida (como la app, con RLS): la fila se queda en consents y no se archiva.
select pg_temp.login_as('aaaaaaaa-0000-4000-8000-000000000001');
update public.consents set withdrawn_at = now() - interval '2 days'
 where id = 'c0000000-0000-4000-8000-0000000000a1';
select throws_ok($$ select * from public.consent_records_archive $$, '42501', null,
                 'un usuario autenticado no puede leer el archivo');
select throws_ok($$ insert into public.consent_records_archive (user_hash, purpose, text_version, granted_at, withdrawn_at)
                    values (repeat('a', 64), 'body_scan', 'x', now(), now()) $$, '42501', null,
                 'ni escribir en él');
select throws_ok($$ delete from public.consents where id = 'c0000000-0000-4000-8000-0000000000a1' $$, '42501', null,
                 'la app no puede borrar sus consentimientos');
select throws_ok($$ select public.purge_consent_archive() $$, '42501', null,
                 'ni ejecutar la purga del archivo');
select throws_ok($$ select public.consent_archive_ready() $$, '42501', null,
                 'ni consultar si el archivo está configurado');
select pg_temp.logout();

select pg_temp.login_anon();
select throws_ok($$ select * from public.consent_records_archive $$, '42501', null,
                 'anon no puede leer el archivo');
select pg_temp.logout();

select is((select withdrawn_at is not null from public.consents where id = 'c0000000-0000-4000-8000-0000000000a1'),
          true, 'retirar un consentimiento en vida lo conserva en consents con su fecha de retirada');
select is((select count(*)::int from public.consent_records_archive), 0, 'retirar en vida no archiva nada');

select ok(public.consent_archive_ready(), 'con el secreto en Vault, el archivo está listo');

-- ---------------------------------------------------------------------------
-- Baja: la cascada archiva cada consentimiento seudonimizado
-- ---------------------------------------------------------------------------
create temp table expected_hash as
select encode(extensions.hmac('aaaaaaaa-0000-4000-8000-000000000001', decrypted_secret, 'sha256'), 'hex') as h
  from vault.decrypted_secrets where name = 'consent_pseudonym_secret';

delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is((select count(*)::int from public.consents where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0,
          'los consentimientos se van de consents con la cuenta');
select is((select count(*)::int from public.consent_records_archive), 2,
          'pero quedan dos registros en el archivo');
select is((select count(distinct user_hash)::int from public.consent_records_archive), 1,
          'ambos con el mismo seudónimo');
select is((select user_hash from public.consent_records_archive limit 1), (select h from expected_hash),
          'el seudónimo es HMAC-SHA256(consent_pseudonym_secret, user_id) en hex');
select isnt((select user_hash from public.consent_records_archive limit 1),
            encode(extensions.digest('aaaaaaaa-0000-4000-8000-000000000001', 'sha256'), 'hex'),
            'y no es un SHA-256 sin secreto (reversible por fuerza bruta sobre UUIDs conocidos)');
select is((select count(*)::int from public.consent_records_archive a
            where to_jsonb(a)::text ilike '%aaaaaaaa-0000-4000-8000-000000000001%'
               or to_jsonb(a)::text ilike '%aaaaaaaa000040008000000000000001%'
               or to_jsonb(a)::text ilike '%c0000000-0000-4000-8000-0000000000a%'),
          0, 'ningún campo archivado contiene el user_id ni el id del consentimiento');
select results_eq(
  $$ select purpose::text, text_version from public.consent_records_archive order by purpose $$,
  $$ values ('body_scan', 'body_scan-v1'), ('color_analysis', 'color-v2') $$,
  'se archivan tratamiento y versión del texto');
select ok((select withdrawn_at = granted_at + interval '8 days' and granted_at < now() - interval '9 days'
             from public.consent_records_archive where purpose = 'body_scan'),
          'el retirado en vida conserva sus fechas de concesión y de retirada');
select ok((select withdrawn_at = now() and archived_at = now()
             from public.consent_records_archive where purpose = 'color_analysis'),
          'el vigente se archiva con la fecha de la baja como retirada');
select is((select count(*)::int from public.consents where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 1,
          'los consentimientos de otros usuarios no se tocan');

-- Sin secreto, la baja falla entera: ni se pierde la prueba ni se guarda el user_id en claro.
delete from vault.secrets where name = 'consent_pseudonym_secret';
select ok(not public.consent_archive_ready(), 'sin secreto en Vault el archivo no está listo');
select throws_like($$ delete from auth.users where id = 'bbbbbbbb-0000-4000-8000-000000000002' $$,
                   '%consent_pseudonym_secret%', 'sin secreto no se puede borrar una cuenta con consentimientos');
select is((select count(*)::int from public.consents where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'), 1,
          'y el consentimiento sigue en su sitio');

-- ---------------------------------------------------------------------------
-- Purga a los 3 años de archivo (pg_cron)
-- ---------------------------------------------------------------------------
insert into public.consent_records_archive (user_hash, purpose, text_version, granted_at, withdrawn_at, archived_at)
values (repeat('1', 64), 'analytics', 'old', now() - interval '5 years', now() - interval '4 years',
        now() - interval '3 years' - interval '1 day'),
       (repeat('2', 64), 'analytics', 'recent', now() - interval '4 years', now() - interval '3 years',
        now() - interval '3 years' + interval '1 day');
select is(public.purge_consent_archive(), 1, 'la purga borra un registro');
select is((select count(*)::int from public.consent_records_archive where text_version = 'old'), 0,
          'el de más de 3 años de archivo desaparece');
select is((select count(*)::int from public.consent_records_archive where text_version = 'recent'), 1,
          'el de menos de 3 años se conserva');
select is((select count(*)::int from cron.job
            where jobname = 'consent-archive-purge' and command like '%purge_consent_archive%'), 1,
          'pg_cron tiene programada la purga del archivo');

-- ---------------------------------------------------------------------------
-- D7: cuota de export-data (5 por usuario y 24 h)
-- ---------------------------------------------------------------------------
select is((select array_agg(public.register_data_export('bbbbbbbb-0000-4000-8000-000000000002', 5))
             from generate_series(1, 6)),
          array[true, true, true, true, true, false],
          'register_data_export admite 5 exportaciones en 24 h y rechaza la sexta');
update public.data_export_requests set created_at = now() - interval '25 hours'
 where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select is(public.register_data_export('bbbbbbbb-0000-4000-8000-000000000002', 5), true,
          'pasadas 24 h vuelve a haber cuota');
select pg_temp.login_as('bbbbbbbb-0000-4000-8000-000000000002');
select throws_ok($$ select public.register_data_export('bbbbbbbb-0000-4000-8000-000000000002', 1000) $$, '42501', null,
                 'la app no puede registrar exportaciones ni saltarse la cuota');
select pg_temp.logout();

select * from finish();
rollback;
