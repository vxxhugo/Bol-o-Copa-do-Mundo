alter table public.bolao_state disable row level security;
alter table public.bolao_state no force row level security;

revoke all on table public.bolao_state from anon;
revoke all on table public.bolao_state from authenticated;
grant select, insert, update, delete on table public.bolao_state to service_role;

select
  relname as tabela,
  relrowsecurity as rls_ativo,
  relforcerowsecurity as rls_forcado
from pg_class
where relname = 'bolao_state';
