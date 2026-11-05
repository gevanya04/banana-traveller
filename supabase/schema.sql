-- =====================================================================
-- Banana Traveller — Supabase schema
-- Run this whole file once in Supabase: SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates its own policies.
-- =====================================================================

-- ---------- Profiles (one per login) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null,
  avatar_path  text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  status       text not null default 'approved' check (status in ('pending', 'approved')),
  created_at   timestamptz not null default now()
);

-- Create a profile automatically whenever a user is invited or signs up.
-- Everyone is approved straight away. (To require admin approval for sign-ups,
-- change the status below to 'pending' — the app's Admin section handles approvals.)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
begin
  insert into public.profiles (id, email, display_name, status)
  values (
    new.id,
    new.email,
    left(coalesce(wanted, initcap(split_part(new.email, '@', 1))), 40),
    'approved'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper checks (security definer so they don't loop through RLS)
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'approved');
$$;

-- Admin approves a pending sign-up
create or replace function public.approve_member(member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can approve members';
  end if;
  update public.profiles set status = 'approved' where id = member_id;
end $$;
revoke execute on function public.approve_member(uuid) from public, anon;
grant execute on function public.approve_member(uuid) to authenticated;

-- Only the trigger may run handle_new_user; helpers are for signed-in members only
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- Memories (photos & videos) ----------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  caption     text,
  trip_tag    text,
  media_path  text not null,
  media_type  text not null check (media_type in ('image', 'video')),
  created_at  timestamptz not null default now()
);

create table if not exists public.memory_reactions (
  memory_id  uuid not null references public.memories(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (memory_id, user_id, emoji)
);

create table if not exists public.memory_comments (
  id         uuid primary key default gen_random_uuid(),
  memory_id  uuid not null references public.memories(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- ---------- Pokes ----------
create table if not exists public.pokes (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  seen       boolean not null default false,
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

-- ---------- Messages (recipient_id null = group chat) ----------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at);

-- ---------- Events ----------
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  location   text,
  notes      text,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

-- =====================================================================
-- Row Level Security: nothing is visible unless you are a signed-in member
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.memories         enable row level security;
alter table public.memory_reactions enable row level security;
alter table public.memory_comments  enable row level security;
alter table public.pokes            enable row level security;
alter table public.messages         enable row level security;
alter table public.events           enable row level security;

-- Profiles: members see approved members, you always see yourself, admin sees
-- everyone (including pending sign-ups). You may only edit your own name/photo.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (
  id = auth.uid() or public.is_admin() or (public.is_member() and status = 'approved')
);
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_path) on public.profiles to authenticated;

-- Memories
drop policy if exists "memories read" on public.memories;
create policy "memories read" on public.memories for select using (public.is_member());
drop policy if exists "memories insert" on public.memories;
create policy "memories insert" on public.memories for insert
  with check (author_id = auth.uid() and public.is_member());
drop policy if exists "memories delete" on public.memories;
create policy "memories delete" on public.memories for delete
  using (author_id = auth.uid() or public.is_admin());

-- Reactions
drop policy if exists "reactions read" on public.memory_reactions;
create policy "reactions read" on public.memory_reactions for select using (public.is_member());
drop policy if exists "reactions insert" on public.memory_reactions;
create policy "reactions insert" on public.memory_reactions for insert
  with check (user_id = auth.uid() and public.is_member());
drop policy if exists "reactions delete" on public.memory_reactions;
create policy "reactions delete" on public.memory_reactions for delete using (user_id = auth.uid());

-- Comments
drop policy if exists "comments read" on public.memory_comments;
create policy "comments read" on public.memory_comments for select using (public.is_member());
drop policy if exists "comments insert" on public.memory_comments;
create policy "comments insert" on public.memory_comments for insert
  with check (author_id = auth.uid() and public.is_member());
drop policy if exists "comments delete" on public.memory_comments;
create policy "comments delete" on public.memory_comments for delete
  using (author_id = auth.uid() or public.is_admin());

-- Pokes: only sender and receiver see a poke
drop policy if exists "pokes read" on public.pokes;
create policy "pokes read" on public.pokes for select
  using (from_id = auth.uid() or to_id = auth.uid());
drop policy if exists "pokes insert" on public.pokes;
create policy "pokes insert" on public.pokes for insert
  with check (from_id = auth.uid() and public.is_member());
drop policy if exists "pokes mark seen" on public.pokes;
create policy "pokes mark seen" on public.pokes for update
  using (to_id = auth.uid()) with check (to_id = auth.uid());
revoke update on public.pokes from authenticated, anon;
grant update (seen) on public.pokes to authenticated;

-- Messages: group chat visible to all members; DMs only to the two people in them
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select using (
  public.is_member() and (
    recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid()
  )
);
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_member());
drop policy if exists "messages delete" on public.messages;
create policy "messages delete" on public.messages for delete using (
  sender_id = auth.uid() or (recipient_id is null and public.is_admin())
);

-- Events
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select using (public.is_member());
drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events for insert
  with check (created_by = auth.uid() and public.is_member());
drop policy if exists "events update" on public.events;
create policy "events update" on public.events for update
  using (created_by = auth.uid() or public.is_admin());
drop policy if exists "events delete" on public.events;
create policy "events delete" on public.events for delete
  using (created_by = auth.uid() or public.is_admin());

-- =====================================================================
-- Private storage bucket for photos & videos (50 MB per file on free plan)
-- Files are stored as <user id>/<file name>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select
  using (bucket_id = 'media' and public.is_member());
drop policy if exists "media upload own folder" on storage.objects;
create policy "media upload own folder" on storage.objects for insert
  with check (bucket_id = 'media' and public.is_member()
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media delete" on storage.objects;
create policy "media delete" on storage.objects for delete
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- =====================================================================
-- Realtime: live chat, pokes and new memories
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['messages', 'pokes', 'memories'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
