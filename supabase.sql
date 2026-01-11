create extension if not exists "uuid-ossp";

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  user_name text not null,
  content text,
  reply_to uuid references public.messages(id) on delete set null,
  reactions jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists messages_created_at_idx on public.messages (created_at);
create index if not exists messages_reply_to_idx on public.messages (reply_to);

create table if not exists public.user_reads (
  username text primary key,
  last_read_at timestamptz not null default now()
);

alter table public.messages disable row level security;
alter table public.user_reads disable row level security;
