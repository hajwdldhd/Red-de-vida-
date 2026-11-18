-- Red de Vida V2 — Supabase schema and security
-- Run this script in Supabase SQL Editor. Review the README before enabling production use.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.redvida_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.redvida_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.redvida_touch_updated_at();

create or replace function public.redvida_protect_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('postgres','supabase_admin','service_role')
     and not public.redvida_is_admin() then
    raise exception 'Only an administrator can change profile roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.redvida_protect_profile_role();

create or replace function public.redvida_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,''),'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists redvida_auth_user_created on auth.users;
create trigger redvida_auth_user_created
after insert on auth.users
for each row execute function public.redvida_handle_new_user();

-- Backfill profiles for Supabase Auth accounts that existed before this migration.
insert into public.profiles (id, display_name)
select id, coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(coalesce(email,''),'@',1))
from auth.users
on conflict (id) do nothing;

create table if not exists public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  phone text not null check (length(trim(phone)) between 5 and 30),
  relationship text not null default 'Otro' check (length(trim(relationship)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trusted_contacts_user_idx on public.trusted_contacts(user_id, created_at desc);
drop trigger if exists trusted_contacts_touch_updated_at on public.trusted_contacts;
create trigger trusted_contacts_touch_updated_at before update on public.trusted_contacts
for each row execute function public.redvida_touch_updated_at();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null default '' check (length(body) <= 500),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.support_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  category text not null default 'General' check (length(trim(category)) between 1 and 60),
  description text not null default '' check (length(description) <= 1000),
  phone_label text,
  phone_href text,
  website_url text,
  is_active boolean not null default true,
  display_order integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_phone_href_safe check (phone_href is null or phone_href ~ '^tel:[0-9+() -]+$'),
  constraint support_website_safe check (website_url is null or website_url ~ '^https://')
);
create index if not exists support_resources_active_idx on public.support_resources(is_active, display_order);

drop trigger if exists support_resources_touch_updated_at on public.support_resources;
create trigger support_resources_touch_updated_at before update on public.support_resources
for each row execute function public.redvida_touch_updated_at();

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null check (length(trim(comment)) between 5 and 1200),
  evidence_path text,
  allow_public boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  constraint evidence_path_belongs_to_user check (
    evidence_path is null or evidence_path like user_id::text || '/%'
  )
);
create index if not exists reviews_public_idx on public.reviews(status, allow_public, created_at desc);
create index if not exists reviews_user_idx on public.reviews(user_id, created_at desc);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('login','contact_created','contact_deleted','review_submitted','resource_opened')),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_created_idx on public.usage_events(created_at desc);

alter table public.profiles enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.notifications enable row level security;
alter table public.support_resources enable row level security;
alter table public.reviews enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles
for select to authenticated using (id = auth.uid() or public.redvida_is_admin());
drop policy if exists "profiles update own or admin" on public.profiles;
create policy "profiles update own or admin" on public.profiles
for update to authenticated using (id = auth.uid() or public.redvida_is_admin())
with check (id = auth.uid() or public.redvida_is_admin());

drop policy if exists "contacts select own or admin" on public.trusted_contacts;
create policy "contacts select own or admin" on public.trusted_contacts
for select to authenticated using (user_id = auth.uid() or public.redvida_is_admin());
drop policy if exists "contacts insert own" on public.trusted_contacts;
create policy "contacts insert own" on public.trusted_contacts
for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "contacts update own or admin" on public.trusted_contacts;
create policy "contacts update own or admin" on public.trusted_contacts
for update to authenticated using (user_id = auth.uid() or public.redvida_is_admin())
with check (user_id = auth.uid() or public.redvida_is_admin());
drop policy if exists "contacts delete own or admin" on public.trusted_contacts;
create policy "contacts delete own or admin" on public.trusted_contacts
for delete to authenticated using (user_id = auth.uid() or public.redvida_is_admin());

drop policy if exists "notifications select own or admin" on public.notifications;
create policy "notifications select own or admin" on public.notifications
for select to authenticated using (user_id = auth.uid() or public.redvida_is_admin());
drop policy if exists "notifications update own or admin" on public.notifications;
create policy "notifications update own or admin" on public.notifications
for update to authenticated using (user_id = auth.uid() or public.redvida_is_admin())
with check (user_id = auth.uid() or public.redvida_is_admin());
drop policy if exists "notifications insert own or admin" on public.notifications;
create policy "notifications insert own or admin" on public.notifications
for insert to authenticated with check (user_id = auth.uid() or public.redvida_is_admin());

drop policy if exists "support resources public active" on public.support_resources;
create policy "support resources public active" on public.support_resources
for select to anon, authenticated using (is_active or public.redvida_is_admin());
drop policy if exists "support resources admin insert" on public.support_resources;
create policy "support resources admin insert" on public.support_resources
for insert to authenticated with check (public.redvida_is_admin());
drop policy if exists "support resources admin update" on public.support_resources;
create policy "support resources admin update" on public.support_resources
for update to authenticated using (public.redvida_is_admin()) with check (public.redvida_is_admin());
drop policy if exists "support resources admin delete" on public.support_resources;
create policy "support resources admin delete" on public.support_resources
for delete to authenticated using (public.redvida_is_admin());

drop policy if exists "reviews public approved or owner or admin" on public.reviews;
create policy "reviews public approved or owner or admin" on public.reviews
for select to anon, authenticated using (
  (status = 'approved' and allow_public = true)
  or user_id = auth.uid()
  or public.redvida_is_admin()
);
drop policy if exists "reviews owner insert pending" on public.reviews;
create policy "reviews owner insert pending" on public.reviews
for insert to authenticated with check (
  user_id = auth.uid() and status = 'pending' and moderated_at is null and moderated_by is null
);
drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews
for update to authenticated using (public.redvida_is_admin())
with check (public.redvida_is_admin());
drop policy if exists "reviews owner delete pending or admin" on public.reviews;
create policy "reviews owner delete pending or admin" on public.reviews
for delete to authenticated using ((user_id = auth.uid() and status = 'pending') or public.redvida_is_admin());

drop policy if exists "usage events insert own" on public.usage_events;
create policy "usage events insert own" on public.usage_events
for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "usage events admin read" on public.usage_events;
create policy "usage events admin read" on public.usage_events
for select to authenticated using (public.redvida_is_admin());

-- Private evidence bucket. An image is only readable by its owner/admin, or
-- by anyone after its associated review is approved and public sharing is allowed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('redvida-evidence','redvida-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "evidence owner upload" on storage.objects;
create policy "evidence owner upload" on storage.objects
for insert to authenticated with check (
  bucket_id = 'redvida-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "evidence owner or approved public read" on storage.objects;
create policy "evidence owner or approved public read" on storage.objects
for select to anon, authenticated using (
  bucket_id = 'redvida-evidence'
  and (
    (auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text)
    or public.redvida_is_admin()
    or exists (
      select 1 from public.reviews r
      where r.evidence_path = name and r.status = 'approved' and r.allow_public = true
    )
  )
);
drop policy if exists "evidence owner delete" on storage.objects;
create policy "evidence owner delete" on storage.objects
for delete to authenticated using (
  bucket_id = 'redvida-evidence'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.redvida_is_admin())
);

create or replace function public.redvida_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if not public.redvida_is_admin() then
    raise exception 'Administrator permission required';
  end if;
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'contacts', (select count(*) from public.trusted_contacts),
    'reviews', (select count(*) from public.reviews),
    'pending_reviews', (select count(*) from public.reviews where status='pending'),
    'approved_reviews', (select count(*) from public.reviews where status='approved' and allow_public=true),
    'average_rating', (select coalesce(round(avg(rating)::numeric,2),0) from public.reviews where status='approved' and allow_public=true),
    'usage_events', (select count(*) from public.usage_events)
  ) into payload;
  return payload;
end;
$$;

revoke all on function public.redvida_admin_stats() from public;
grant execute on function public.redvida_admin_stats() to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.support_resources to anon, authenticated;
grant select, insert, update, delete on public.trusted_contacts to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.support_resources to authenticated;
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
grant select, insert on public.usage_events to authenticated;
grant select, update on public.profiles to authenticated;
