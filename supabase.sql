create extension if not exists "uuid-ossp";

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  room_code text not null default 'main',
  user_name text not null,
  content text,
  reply_to uuid references public.messages(id) on delete set null,
  reactions jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.user_reads (
  username text not null,
  room_code text not null default 'main',
  last_read_at timestamptz not null default now()
);

create table if not exists public.typing_status (
  username text not null,
  room_code text not null default 'main',
  is_typing boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists room_code text not null default 'main',
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists reply_to uuid;

alter table public.user_reads
  add column if not exists room_code text not null default 'main';

alter table public.typing_status
  add column if not exists room_code text not null default 'main',
  add column if not exists is_typing boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Ensure reply foreign key exists (for upgraded projects).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_reply_to_fkey'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_reply_to_fkey
      foreign key (reply_to) references public.messages(id) on delete set null;
  end if;
end $$;

-- Ensure typing_status has composite PK (username, room_code).
do $$
declare
  existing_pk_name text;
  existing_pk_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid)
    into existing_pk_name, existing_pk_def
  from pg_constraint c
  where c.conrelid = 'public.typing_status'::regclass
    and c.contype = 'p'
  limit 1;

  if existing_pk_name is not null
     and existing_pk_def <> 'PRIMARY KEY (username, room_code)' then
    execute format('alter table public.typing_status drop constraint %I', existing_pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.typing_status'::regclass
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (username, room_code)'
  ) then
    alter table public.typing_status
      add constraint typing_status_pkey primary key (username, room_code);
  end if;
end $$;

-- Ensure user_reads has composite PK (username, room_code).
do $$
declare
  existing_pk_name text;
  existing_pk_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid)
    into existing_pk_name, existing_pk_def
  from pg_constraint c
  where c.conrelid = 'public.user_reads'::regclass
    and c.contype = 'p'
  limit 1;

  if existing_pk_name is not null
     and existing_pk_def <> 'PRIMARY KEY (username, room_code)' then
    execute format('alter table public.user_reads drop constraint %I', existing_pk_name);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.user_reads'::regclass
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (username, room_code)'
  ) then
    alter table public.user_reads
      add constraint user_reads_pkey primary key (username, room_code);
  end if;
end $$;

create index if not exists messages_created_at_idx
  on public.messages (created_at);

create index if not exists messages_room_created_idx
  on public.messages (room_code, created_at);

create index if not exists messages_reply_to_idx
  on public.messages (reply_to);

alter table public.messages disable row level security;
alter table public.user_reads disable row level security;
alter table public.typing_status disable row level security;

grant usage on schema public to anon, authenticated;
grant all on table public.messages to anon, authenticated;
grant all on table public.user_reads to anon, authenticated;
grant all on table public.typing_status to anon, authenticated;

-- Storage bucket for image uploads.
insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

-- Allow reads/writes for objects in the chat bucket.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_uploads_all'
  ) then
    create policy chat_uploads_all
      on storage.objects
      for all
      using (bucket_id = 'chat-uploads')
      with check (bucket_id = 'chat-uploads');
  end if;
end $$;
