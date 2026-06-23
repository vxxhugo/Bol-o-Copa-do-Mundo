create table if not exists public.bolao_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bolao_state disable row level security;
