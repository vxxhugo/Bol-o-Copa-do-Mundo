# Bolao Copa do Mundo

Site com login, cadastro, palpites, calendario, classificacao ao vivo e painel de administrador.

## Publicar no GitHub, Supabase e Vercel

1. Crie um repositorio no GitHub.
2. Envie todos os arquivos desta pasta para a raiz do repositorio.
3. Crie um projeto no Supabase.
4. No Supabase, abra **SQL Editor** e execute o arquivo `supabase-schema.sql`.
5. Na Vercel, importe esse repositorio do GitHub.
6. Na Vercel, adicione as variaveis de ambiente:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD` opcional, mas recomendado
7. Faca um novo deploy.

Depois disso, todos acessam o mesmo link da Vercel e compartilham as mesmas contas, palpites, jogos e ranking.

## Login de administrador

- E-mail: `admin@bolao.com`
- Senha: `admin123`

Para trocar a senha antes de publicar, adicione uma variavel de ambiente na Vercel chamada `ADMIN_PASSWORD` com a nova senha. Se quiser trocar o e-mail do admin, use `ADMIN_EMAIL`.

## Observacoes

- O site usa a API da ESPN para buscar jogos e placares.
- A atualizacao automatica acontece a cada 10 segundos.
- O Supabase fica apenas no servidor. Nao coloque a `SUPABASE_SERVICE_ROLE_KEY` dentro do `app.js` ou em codigo do navegador.
- Sem as variaveis do Supabase configuradas na Vercel, a API nao consegue salvar contas e palpites de forma compartilhada.
- Se a RLS tiver sido ativada no Supabase, execute `supabase-corrigir-rls.sql` no SQL Editor.
- Em `SUPABASE_SERVICE_ROLE_KEY`, use a chave `service_role secret`, nao a `anon public`.
