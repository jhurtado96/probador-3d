-- =============================================================================
-- Probador virtual 3D · 0001 · Extensiones, esquemas y tipos enumerados
--
-- Los valores de cada enum son exactamente las constantes de
-- packages/contracts/src/index.ts (v0.1.0). Si el contrato añade un valor, se
-- añade aquí con `alter type ... add value` en una migración nueva.
-- =============================================================================

-- Extensiones -----------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;    -- pgvector: embeddings de prendas
create extension if not exists pg_net with schema extensions;    -- llamadas HTTP desde pg_cron
create extension if not exists pg_cron with schema pg_catalog;   -- barridos y reintentos
-- supabase_vault viene instalada en Supabase: guarda la URL del proyecto y el
-- secreto con el que pg_cron llama a la Edge Function `maintenance`.

-- Esquema privado: funciones auxiliares que no expone la API REST -------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Enums del contrato -------------------------------------------------------------
create type public.body_model as enum ('smplx', 'anny');
create type public.body_model_gender as enum ('neutral', 'female', 'male');
create type public.measurement_source as enum ('photo', 'photo_reference_object', 'lidar', 'manual');
create type public.avatar_pose as enum ('a_pose', 't_pose', 'relaxed');

create type public.color_season as enum (
  'light_spring', 'warm_spring', 'bright_spring',
  'light_summer', 'cool_summer', 'soft_summer',
  'soft_autumn', 'warm_autumn', 'deep_autumn',
  'deep_winter', 'cool_winter', 'bright_winter'
);
create type public.undertone as enum ('cool', 'neutral', 'warm', 'olive');
create type public.color_value as enum ('light', 'medium', 'deep');
create type public.color_intensity as enum ('soft', 'medium', 'bright');
create type public.contrast_level as enum ('low', 'medium', 'high');
create type public.metal as enum ('gold', 'silver', 'rose_gold', 'any');

create type public.garment_category as enum (
  'tshirt', 'shirt', 'sweater', 'hoodie', 'jacket', 'coat',
  'dress', 'skirt', 'pants', 'jeans', 'shorts'
);
create type public.design_fit as enum ('slim', 'regular', 'relaxed', 'oversize');
create type public.garment_measurement_source as enum (
  'brand_size_chart', 'photo_reference_object', 'lidar', 'manual', 'estimated'
);
create type public.garment_status as enum ('processing', 'ready', 'failed');

create type public.fit_verdict as enum ('too_small', 'fits', 'too_large');
create type public.fit_method as enum ('size_chart', 'measured', 'simulated');

create type public.outfit_source as enum ('user', 'recommendation', 'stylist');

create type public.affiliate_network as enum ('awin', 'rakuten', 'cj', 'impact', 'zalando', 'shopify');
create type public.target_gender as enum ('women', 'men', 'unisex', 'kids');

create type public.job_type as enum ('avatar', 'garment', 'drape', 'color');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');
create type public.drape_quality as enum ('preview', 'final');

-- Fuera del contrato (no hay tipo Consent en packages/contracts v0.1.0): los
-- cuatro tratamientos de docs/architecture.md §4.
create type public.consent_purpose as enum ('body_scan', 'color_analysis', 'personalization', 'analytics');

-- Utilidades comunes --------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
