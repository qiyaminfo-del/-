-- يحاكي الجزء الذي توفّره Supabase: مخطط auth ودالة auth.uid() وأدوار anon/authenticated.
-- auth.uid() تقرأ request.jwt.claim.sub كما تفعل Supabase (ضبطها يحاكي دخول مستخدم).
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;

grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- أسوأ حالة: Supabase القياسي يمنح anon وauthenticated كل شيء على الجداول والدوال افتراضيًا
-- (عبر default privileges). الهجرات يجب أن تسحب ما لا يلزم؛ الاختبارات تتحقق من ذلك.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
