-- =============================================================================
-- Probador virtual 3D · 0010 · Prueba del consentimiento fijada por el servidor
-- (revisión de la fase 0: M1, B1)
--
-- M1. Antes el cliente escribía `granted_at`, `created_at` y `text_version` a su
-- antojo, y el archivo D6 guardaba un seudónimo que nadie podía recalcular tras
-- la baja. Ahora:
--   * `consent_texts` publica cada versión del texto legal (texto íntegro y su
--     SHA-256). Es de solo inserción: una versión publicada no se cambia ni se
--     borra, porque los consentimientos y el archivo la citan.
--   * La app solo puede insertar `purpose` y, si quiere, `text_version`
--     (privilegio por columna). Un trigger fija `granted_at` y `created_at` con
--     la hora del servidor, rellena `text_version` con la versión vigente del
--     tratamiento y rechaza cualquier otra. Una clave foránea impide citar una
--     versión que no existe.
--   * Tratamiento, versión, usuario y fecha de concesión no cambian después de
--     insertar (solo `withdrawn_at`, una vez).
--   * El archivo guarda además `email_hash` = HMAC-SHA256(secreto,
--     "email:" + email normalizado), que es lo que aportará quien reclame. El
--     email se toma de auth.users antes de que la baja lo borre.
--     `consent_archive_lookup` (solo service_role) busca por email o por user_id
--     calculando el HMAC dentro de Postgres: el secreto nunca sale de Vault.
--
-- B1. `purge_consent_archive` ya no la puede ejecutar service_role: solo pg_cron.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Textos legales versionados
-- -----------------------------------------------------------------------------
create table public.consent_texts (
  purpose      public.consent_purpose not null,
  version      text not null check (char_length(version) between 1 and 64),
  body         text not null check (char_length(body) between 1 and 20000),
  sha256       text not null generated always as (encode(extensions.digest(body, 'sha256'), 'hex')) stored,
  published_at timestamptz not null default now(),
  primary key (purpose, version)
);
comment on table public.consent_texts is
  'Versiones publicadas de los textos de consentimiento (M1). Solo inserción: la vigente de cada tratamiento '
  'es la última publicada. Se publican con una migración nueva, nunca editando una fila.';

alter table public.consent_texts enable row level security;
revoke all on table public.consent_texts from public, anon, authenticated, service_role;
grant select on table public.consent_texts to anon, authenticated, service_role;
create policy consent_texts_public_read on public.consent_texts for select to anon, authenticated using (true);

create or replace function private.consent_texts_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'consent_texts is append-only: publish a new version instead' using errcode = '42501';
end;
$$;
create trigger consent_texts_append_only
  before update or delete on public.consent_texts
  for each row execute function private.consent_texts_append_only();

-- Versión vigente de un tratamiento.
create or replace function public.current_consent_text_version(p_purpose public.consent_purpose)
returns text
language sql
stable
set search_path = ''
as $$
  select t.version from public.consent_texts t
   where t.purpose = p_purpose
   order by t.published_at desc, t.version desc
   limit 1;
$$;
grant execute on function public.current_consent_text_version(public.consent_purpose) to anon, authenticated, service_role;

-- Borradores iniciales. PENDIENTE (usuario y abogado): sustituirlos por los
-- textos definitivos publicando versiones nuevas en una migración.
insert into public.consent_texts (purpose, version, body, published_at) values
  ('body_scan', 'body_scan-2026-11-draft',
   'BORRADOR pendiente de revisión legal. Consiento que se procese una foto de mi cuerpo entero para calcular un '
   'avatar 3D y mis medidas corporales. La foto se borra al terminar el procesamiento (como máximo en una hora) y '
   'solo se conservan el avatar y las medidas, que puedo corregir o borrar. Puedo retirar este consentimiento en '
   'cualquier momento: se borrarán el avatar, las medidas y todo lo calculado a partir de la foto.',
   '2026-11-11T00:00:00Z'),
  ('color_analysis', 'color_analysis-2026-11-draft',
   'BORRADOR pendiente de revisión legal. Consiento que se procese un selfie para medir el color de mi piel, pelo '
   'e iris y calcular mi estación de colorimetría. El selfie se borra al terminar el procesamiento. Puedo retirar '
   'este consentimiento en cualquier momento: se borrará mi perfil de color completo, también si corregí la '
   'estación a mano.',
   '2026-11-11T00:00:00Z'),
  ('personalization', 'personalization-2026-11-draft',
   'BORRADOR pendiente de revisión legal. Consiento que se usen mi armario, mis medidas y mis preferencias de fit '
   'para recomendarme prendas y tiendas. Puedo retirarlo en cualquier momento y se borrarán las recomendaciones.',
   '2026-11-11T00:00:00Z'),
  ('analytics', 'analytics-2026-11-draft',
   'BORRADOR pendiente de revisión legal. Consiento que se recojan datos de uso de la app para mejorarla. Puedo '
   'retirarlo en cualquier momento.',
   '2026-11-11T00:00:00Z');

-- -----------------------------------------------------------------------------
-- consents: el servidor fija fecha y versión; la prueba no se puede reescribir
-- -----------------------------------------------------------------------------
alter table public.consents
  add constraint consents_text_version_fkey
  foreign key (purpose, text_version) references public.consent_texts (purpose, version);

-- La app solo envía el tratamiento (y, si quiere, la versión que mostró).
revoke insert on public.consents from authenticated;
grant insert (purpose, text_version) on public.consents to authenticated;

create or replace function private.consent_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current text := public.current_consent_text_version(new.purpose);
begin
  if v_current is null then
    raise exception 'no consent text is published for %', new.purpose using errcode = '23503';
  end if;
  if new.text_version is null then
    new.text_version := v_current;
  elsif new.text_version <> v_current then
    raise exception 'text_version % is not the current version for % (%)', new.text_version, new.purpose, v_current
      using errcode = '23514';
  end if;
  new.granted_at := now();
  new.created_at := now();
  new.withdrawn_at := null;
  return new;
end;
$$;
create trigger consents_server_fields
  before insert on public.consents
  for each row execute function private.consent_before_insert();

create or replace function private.consent_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.purpose is distinct from old.purpose
     or new.text_version is distinct from old.text_version or new.granted_at is distinct from old.granted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'a consent record cannot be rewritten; only withdrawn_at can be set' using errcode = '42501';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a withdrawn consent cannot be changed' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null and old.withdrawn_at is null then
    new.withdrawn_at := greatest(now(), new.granted_at);  -- la fecha de retirada también la pone el servidor
  end if;
  return new;
end;
$$;
create trigger consents_immutable_proof
  before update on public.consents
  for each row execute function private.consent_before_update();

-- -----------------------------------------------------------------------------
-- Archivo D6: seudónimo del email, recalculable ante una reclamación
-- -----------------------------------------------------------------------------
alter table public.consent_records_archive
  add column email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$');
create index consent_records_archive_email_hash_idx on public.consent_records_archive (email_hash);
comment on column public.consent_records_archive.email_hash is
  'HMAC-SHA256(consent_pseudonym_secret, "email:" + lower(trim(email))) en hex: permite encontrar el registro con '
  'el email que aporte quien reclame. Null si la cuenta no tenía email. El email en claro no se guarda.';

create or replace function private.consent_pseudonym_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'consent_pseudonym_secret';
  if v_secret is null or char_length(v_secret) < 32 then
    raise exception 'consent archive unavailable: vault secret consent_pseudonym_secret is missing or shorter than 32 characters'
      using hint = 'select vault.create_secret(''<32+ caracteres aleatorios>'', ''consent_pseudonym_secret'');';
  end if;
  return v_secret;
end;
$$;

create or replace function private.consent_email_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when nullif(btrim(p_email), '') is null then null
              else encode(extensions.hmac('email:' || lower(btrim(p_email)), private.consent_pseudonym_secret(),
                                          'sha256'), 'hex') end;
$$;

-- La cascada de la baja borra auth.users ANTES que consents: el email se
-- seudonimiza aquí y se pasa al trigger de archivo en una variable de la
-- transacción (no se guarda en ninguna tabla).
create or replace function private.stash_deleted_user_email_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.consents c where c.user_id = old.id) then
    perform set_config('probador.eh_' || replace(old.id::text, '-', ''),
                       coalesce(private.consent_email_hash(old.email), ''), true);
  end if;
  return old;
end;
$$;
create trigger on_auth_user_deleting
  before delete on auth.users
  for each row execute function private.stash_deleted_user_email_hash();

create or replace function private.archive_consent_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email_hash text := nullif(current_setting('probador.eh_' || replace(old.user_id::text, '-', ''), true), '');
begin
  if v_email_hash is null then
    select private.consent_email_hash(u.email) into v_email_hash from auth.users u where u.id = old.user_id;
  end if;
  insert into public.consent_records_archive
    (user_hash, email_hash, purpose, text_version, granted_at, withdrawn_at, archived_at)
  values (private.consent_user_hash(old.user_id), v_email_hash, old.purpose, old.text_version, old.granted_at,
          coalesce(old.withdrawn_at, greatest(now(), old.granted_at)), now());
  return old;
end;
$$;

-- Búsqueda para atender una reclamación o a una autoridad (art. 32 LOPDGDD).
-- Solo service_role; el uso fuera de esa finalidad está prohibido (ver el
-- comentario de la tabla).
create or replace function public.consent_archive_lookup(p_email text default null, p_user_id uuid default null)
returns setof public.consent_records_archive
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.consent_records_archive a
   where (p_email is not null and a.email_hash = private.consent_email_hash(p_email))
      or (p_user_id is not null and a.user_hash = private.consent_user_hash(p_user_id))
   order by a.archived_at, a.purpose;
$$;

revoke all on function private.consent_texts_append_only() from public, anon, authenticated;
revoke all on function private.consent_before_insert() from public, anon, authenticated;
revoke all on function private.consent_before_update() from public, anon, authenticated;
revoke all on function private.consent_pseudonym_secret() from public, anon, authenticated;
revoke all on function private.consent_email_hash(text) from public, anon, authenticated;
revoke all on function private.stash_deleted_user_email_hash() from public, anon, authenticated;
revoke all on function public.consent_archive_lookup(text, uuid) from public, anon, authenticated;
grant execute on function public.consent_archive_lookup(text, uuid) to service_role;

-- B1: la purga del archivo solo la ejecuta pg_cron (postgres), no service_role.
revoke execute on function public.purge_consent_archive(interval) from service_role;
