-- =============================================================================
-- Probador virtual 3D · 0007 · Archivo bloqueado de consentimientos (D6)
--
-- docs/architecture.md §7, D6: al borrar la cuenta, los consentimientos no se
-- pierden en cascada. De cada uno se conserva un registro mínimo y
-- seudonimizado, bloqueado (art. 32 LOPDGDD), durante 3 años, para poder
-- demostrar el consentimiento (art. 7.1 RGPD). Después se borra.
--
-- Cómo funciona:
--   * Un trigger BEFORE DELETE en public.consents copia cada fila al archivo
--     ANTES de que desaparezca, sea cual sea el camino del borrado: la cascada
--     de delete-account (auth.users → profiles → consents), un borrado del
--     usuario desde el panel de Auth o un DELETE con service_role.
--   * El user_id nunca se guarda: se guarda HMAC-SHA256(secreto, user_id) en
--     hex. El secreto vive en Vault (`consent_pseudonym_secret`, 32+ caracteres)
--     y no sale de Postgres. Si falta, el borrado FALLA: es preferible no borrar
--     la cuenta a perder la prueba o guardar el user_id en claro.
--   * pg_cron borra cada día los registros con más de 3 años de archivo.
--
-- Consentimientos retirados en vida: el trigger de retirada
-- (private.on_consent_withdrawn) NO borra la fila de consents, solo los datos
-- derivados; la fila queda con withdrawn_at como prueba mientras la cuenta
-- existe (el usuario la ve y la exporta). Al borrar la cuenta se archiva con su
-- fecha de retirada real. Así hay un único camino de archivo y ningún
-- consentimiento retirado se pierde.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabla de archivo: exactamente estos campos, ninguno más.
-- -----------------------------------------------------------------------------
create table public.consent_records_archive (
  -- HMAC-SHA256(consent_pseudonym_secret, user_id::text) en hex. Nunca el user_id.
  user_hash    text not null check (user_hash ~ '^[0-9a-f]{64}$'),
  purpose      public.consent_purpose not null,
  text_version text not null check (char_length(text_version) between 1 and 64),
  granted_at   timestamptz not null,
  -- Fecha de retirada; si seguía vigente, la de la baja.
  withdrawn_at timestamptz not null,
  archived_at  timestamptz not null default now(),
  constraint consent_records_archive_withdrawn_after_granted check (withdrawn_at >= granted_at)
);
create index consent_records_archive_archived_at_idx on public.consent_records_archive (archived_at);
create index consent_records_archive_user_hash_idx on public.consent_records_archive (user_hash);

comment on table public.consent_records_archive is
  'Registro mínimo y seudonimizado de los consentimientos de cuentas borradas (docs/architecture.md §7, D6). '
  'Datos BLOQUEADOS conforme al art. 32 LOPDGDD (LO 3/2018): solo pueden consultarse para atender a '
  'jueces y tribunales, al Ministerio Fiscal o a las autoridades de protección de datos, o para la '
  'defensa ante reclamaciones; su finalidad es poder demostrar el consentimiento (art. 7.1 RGPD). '
  'Sin políticas RLS ni privilegios para anon/authenticated; solo service_role puede leer. '
  'pg_cron (consent-archive-purge) borra los registros con más de 3 años de archivo.';
comment on column public.consent_records_archive.user_hash is
  'HMAC-SHA256 del user_id con el secreto de Vault consent_pseudonym_secret, en hex. El user_id en claro no se guarda.';
comment on column public.consent_records_archive.withdrawn_at is
  'Fecha de retirada; si el consentimiento seguía vigente, la fecha de la baja.';

-- Bloqueo: RLS sin políticas y sin privilegios para la app. Solo service_role
-- lee (y salta RLS); nadie salvo el trigger (dueño) y la purga escribe.
alter table public.consent_records_archive enable row level security;
revoke all on table public.consent_records_archive from public, anon, authenticated, service_role;
grant select on table public.consent_records_archive to service_role;

-- -----------------------------------------------------------------------------
-- Seudónimo: HMAC-SHA256 con el secreto de Vault.
-- -----------------------------------------------------------------------------
create or replace function private.consent_user_hash(p_user_id uuid)
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
  return encode(extensions.hmac(p_user_id::text, v_secret, 'sha256'), 'hex');
end;
$$;
revoke all on function private.consent_user_hash(uuid) from public, anon, authenticated;

-- ¿Está configurado el secreto? delete-account lo comprueba antes de borrar
-- Storage, para no dejar una baja a medias.
create or replace function public.consent_archive_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
     where name = 'consent_pseudonym_secret' and char_length(decrypted_secret) >= 32);
$$;

-- -----------------------------------------------------------------------------
-- Archivo antes de cada borrado de consents (incluida la cascada de la baja).
-- -----------------------------------------------------------------------------
create or replace function private.archive_consent_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.consent_records_archive (user_hash, purpose, text_version, granted_at, withdrawn_at, archived_at)
  values (private.consent_user_hash(old.user_id), old.purpose, old.text_version, old.granted_at,
          coalesce(old.withdrawn_at, greatest(now(), old.granted_at)), now());
  return old;
end;
$$;
revoke all on function private.archive_consent_before_delete() from public, anon, authenticated;

create trigger consents_archive_before_delete
  before delete on public.consents
  for each row execute function private.archive_consent_before_delete();

comment on table public.consents is
  'Consentimientos por tratamiento (RGPD). No se borran al retirarlos: quedan como prueba mientras exista la cuenta. '
  'Al borrarse (baja o cualquier DELETE) se copian seudonimizados a consent_records_archive (D6).';

-- -----------------------------------------------------------------------------
-- Purga a los 3 años de archivo. Solo la ejecuta pg_cron (postgres): ni
-- service_role puede borrar del archivo.
-- -----------------------------------------------------------------------------
create or replace function public.purge_consent_archive(p_older_than interval default interval '3 years')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.consent_records_archive where archived_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.consent_archive_ready() from public, anon, authenticated;
revoke all on function public.purge_consent_archive(interval) from public, anon, authenticated;
grant execute on function public.consent_archive_ready() to service_role;

select cron.schedule('consent-archive-purge', '41 3 * * *', $$ select public.purge_consent_archive(); $$);
