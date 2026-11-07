-- ============================================================
-- منصة مجالس — كل قاعدة البيانات في ملف واحد لمشروع Supabase جديد
-- الصقه كاملًا في SQL Editor ثم اضغط Run مرة واحدة.
-- يجمع بالترتيب: 0001 → 0002 → 0003 → seed → 0004 → 0005 → 0006 → 0007
-- يعمل كمعاملة واحدة: إما ينجح كله أو لا يتغير شيء، وإعادة تشغيله آمنة.
-- مولَّد تلقائيًا بـ npm run db:bundle من supabase/migrations (آخرها 0007). لا تعدّله يدويًا.
-- ============================================================

begin;

-- المناظر لا تحمل بيانات؛ تُحذف لتُبنى بصيغتها الأخيرة (0005 وسّع منظر الرصيد).
drop view if exists v_officer_performance, v_enrollment_balance, v_student_attendance_stats,
  v_task_completion, v_session_attendance_summary, v_session_contacts cascade;

-- >>>>>>>>>>>>>>>>>>>> migrations/0001_schema.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — المخطط الأساسي
-- 0001_schema.sql
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- الأنواع ----------
do $$ begin
  create type role_key as enum (
    'sheikh', 'admin', 'contact_officer', 'attendance_officer',
    'finance_officer', 'tasks_officer', 'transcription_officer',
    'member', 'student'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type circle_type as enum ('public', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attendance_state as enum ('present', 'late', 'excused', 'absent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contact_outcome as enum ('confirmed', 'apologized', 'no_answer', 'wrong_number');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_type as enum ('worship', 'activity', 'initiative', 'research');
exception when duplicate_object then null; end $$;

do $$ begin
  create type progress_state as enum ('not_started', 'partial', 'done', 'stalled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reason_code as enum ('forgot', 'circumstance', 'unclear_task', 'dropped_out', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash', 'transfer', 'wallet');
exception when duplicate_object then null; end $$;

do $$ begin
  create type summary_status as enum ('draft', 'pending_review', 'approved', 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('scheduled', 'open', 'closed');
exception when duplicate_object then null; end $$;

-- ---------- الجداول ----------

-- الملفات الشخصية (مرتبطة بمستخدمي auth)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  age int check (age is null or (age between 5 and 120)),
  university text,
  major text,
  city text,
  source text,                       -- كيف عرف المجلس
  notes text,
  created_at timestamptz not null default now()
);

-- المجالس
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type circle_type not null default 'public',
  sheikh_id uuid references profiles(id),
  schedule_rule text,                -- مثال: كل سبت 8 مساءً
  location text,
  parent_circle_id uuid references circles(id),  -- المجلس الخاص يتبع العام
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- خطط الرسوم
create table if not exists fee_plans (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  name text not null,
  total_amount numeric(12,2) not null default 0,
  installments int not null default 1 check (installments >= 1),
  currency text not null default 'EGP',
  created_at timestamptz not null default now()
);

-- انتساب الطالب لمجلس
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  fee_plan_id uuid references fee_plans(id),
  exempt_reason text,                -- إعفاء بسبب مسجل
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  unique (circle_id, student_id)
);

-- الأدوار داخل مجلس بعينه
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  role role_key not null,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (profile_id, circle_id, role)
);

-- نطاق المسؤول: أي الطلاب أُسنِدوا إليه
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (role_id, student_id)
);

-- الجلسات
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  title text,
  held_at timestamptz not null,
  status session_status not null default 'scheduled',
  recording_url text,
  created_at timestamptz not null default now()
);

-- سجل التواصل والتأكيد
create table if not exists contacts_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  by_profile_id uuid not null references profiles(id),
  channel text not null default 'whatsapp',
  outcome contact_outcome not null,
  note text,
  contacted_at timestamptz not null default now()
);

-- الحضور
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  state attendance_state not null,
  marked_by uuid references profiles(id),
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);

-- المدفوعات (لا تُحذف أبدًا — التصحيح بقيد عكسي)
create sequence if not exists receipt_seq start 1000;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  amount numeric(12,2) not null,
  method payment_method not null default 'cash',
  receipt_no bigint not null default nextval('receipt_seq'),
  collected_by uuid references profiles(id),
  paid_at timestamptz not null default now(),
  reversal_of uuid references payments(id),
  note text
);

-- التكاليف
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  type task_type not null,
  title text not null,
  description text,
  due_at timestamptz,
  recurrence text,                  -- daily للعبادات، null لغيرها
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- إنجاز الطالب للتكليف
create table if not exists task_progress (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  state progress_state not null default 'not_started',
  percent int not null default 0 check (percent between 0 and 100),
  days_done jsonb not null default '[]'::jsonb,   -- للعبادات المتكررة
  evidence_url text,
  reason reason_code,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id)
);

-- التفريغ والملخص
create table if not exists summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  transcript_url text,
  summary_md text,
  status summary_status not null default 'draft',
  by_profile_id uuid references profiles(id),
  approved_by uuid references profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id)
);

-- قوالب رسائل واتساب
create table if not exists wa_templates (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  key text not null,
  label text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ملاحظات الشيخ الخاصة
create table if not exists sheikh_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  body text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- سجل التدقيق
create table if not exists audit_log (
  id bigserial primary key,
  actor_id uuid,
  entity text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- ---------- الفهارس ----------
create index if not exists idx_roles_profile on roles(profile_id) where revoked_at is null;
create index if not exists idx_roles_circle on roles(circle_id) where revoked_at is null;
create index if not exists idx_assign_role on assignments(role_id) where revoked_at is null;
create index if not exists idx_assign_student on assignments(student_id) where revoked_at is null;
create index if not exists idx_sessions_circle on sessions(circle_id, held_at desc);
create index if not exists idx_contacts_session on contacts_log(session_id, student_id);
create index if not exists idx_attendance_session on attendance(session_id);
create index if not exists idx_payments_enrollment on payments(enrollment_id);
create index if not exists idx_progress_task on task_progress(task_id);
create index if not exists idx_enroll_circle on enrollments(circle_id);

-- ---------- منع حذف المدفوعات ----------
create or replace function forbid_payment_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'لا يجوز حذف إيصال. استخدم قيدًا عكسيًا (reversal_of).';
end $$;

drop trigger if exists trg_no_payment_delete on payments;
create trigger trg_no_payment_delete before delete on payments
for each row execute function forbid_payment_delete();

-- ---------- سجل التدقيق التلقائي ----------
create or replace function write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor_id, entity, entity_id, action, before, after)
  values (
    auth.uid(),
    tg_table_name,
    coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments','roles','assignments','attendance','task_progress','summaries','enrollments']
  loop
    execute format('drop trigger if exists trg_audit_%1$s on %1$s', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on %1$s
       for each row execute function write_audit()', t);
  end loop;
end $$;

-- ---------- إنشاء ملف شخصي تلقائيًا عند التسجيل ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- >>>>>>>>>>>>>>>>>>>> migrations/0002_rls.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — سياسات الحماية على مستوى الصف (RLS)
-- 0002_rls.sql
-- القاعدة: لا يقرأ المسؤول إلا صفوف الطلاب المُسنَدين إليه.
-- الدوال أدناه security definer حتى لا تتكرر السياسات على نفسها.
-- ============================================================

-- هل لي هذا الدور في هذا المجلس؟
create or replace function has_role(p_circle uuid, p_role role_key)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r
    where r.profile_id = auth.uid()
      and r.circle_id = p_circle
      and r.role = p_role
      and r.revoked_at is null
  );
$$;

-- هل أنا مدير أو شيخ في هذا المجلس (أو في المجلس الأب)؟
create or replace function is_steward(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r
    join circles c on c.id = r.circle_id
    where r.profile_id = auth.uid()
      and r.revoked_at is null
      and r.role in ('admin', 'sheikh')
      and (r.circle_id = p_circle
           or p_circle in (select id from circles where parent_circle_id = r.circle_id))
  );
$$;

-- هل أنا مدير أو شيخ في أي مجلس؟ (للاستعلامات العامة)
create or replace function is_steward_anywhere()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r
    where r.profile_id = auth.uid()
      and r.revoked_at is null
      and r.role in ('admin', 'sheikh')
  );
$$;

-- هل هذا الطالب داخل نطاقي بهذا الدور؟
create or replace function in_my_scope(p_student uuid, p_role role_key)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignments a
    join roles r on r.id = a.role_id
    where r.profile_id = auth.uid()
      and r.role = p_role
      and r.revoked_at is null
      and a.revoked_at is null
      and a.student_id = p_student
  );
$$;

-- هل أنا منتسب لهذا المجلس بأي صفة؟
create or replace function in_circle(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e
    where e.student_id = auth.uid() and e.circle_id = p_circle
  ) or exists (
    select 1 from roles r
    where r.profile_id = auth.uid() and r.circle_id = p_circle and r.revoked_at is null
  );
$$;

-- مجلس الجلسة
create or replace function session_circle(p_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select circle_id from sessions where id = p_session;
$$;

-- ============================================================
alter table profiles      enable row level security;
alter table circles       enable row level security;
alter table fee_plans     enable row level security;
alter table enrollments   enable row level security;
alter table roles         enable row level security;
alter table assignments   enable row level security;
alter table sessions      enable row level security;
alter table contacts_log  enable row level security;
alter table attendance    enable row level security;
alter table payments      enable row level security;
alter table tasks         enable row level security;
alter table task_progress enable row level security;
alter table summaries     enable row level security;
alter table wa_templates  enable row level security;
alter table sheikh_notes  enable row level security;
alter table audit_log     enable row level security;

-- ---------------- profiles ----------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or is_steward_anywhere()
  or in_my_scope(id, 'contact_officer')
  or in_my_scope(id, 'attendance_officer')
  or in_my_scope(id, 'finance_officer')
  or in_my_scope(id, 'tasks_officer')
);

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (
  id = auth.uid() or is_steward_anywhere() or in_my_scope(id, 'contact_officer')
);

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert with check (
  id = auth.uid() or is_steward_anywhere()
);

-- ---------------- circles ----------------
drop policy if exists circles_select on circles;
create policy circles_select on circles for select using (
  type = 'public' or in_circle(id) or is_steward_anywhere()
);

drop policy if exists circles_write on circles;
create policy circles_write on circles for all using (is_steward(id)) with check (is_steward(id));

-- ---------------- fee_plans ----------------
drop policy if exists fee_plans_select on fee_plans;
create policy fee_plans_select on fee_plans for select using (
  is_steward(circle_id) or has_role(circle_id, 'finance_officer') or in_circle(circle_id)
);

drop policy if exists fee_plans_write on fee_plans;
create policy fee_plans_write on fee_plans for all
  using (is_steward(circle_id)) with check (is_steward(circle_id));

-- ---------------- enrollments ----------------
drop policy if exists enrollments_select on enrollments;
create policy enrollments_select on enrollments for select using (
  student_id = auth.uid()
  or is_steward(circle_id)
  or in_my_scope(student_id, 'contact_officer')
  or in_my_scope(student_id, 'attendance_officer')
  or in_my_scope(student_id, 'finance_officer')
  or in_my_scope(student_id, 'tasks_officer')
);

drop policy if exists enrollments_write on enrollments;
create policy enrollments_write on enrollments for all using (
  is_steward(circle_id) or has_role(circle_id, 'contact_officer')
) with check (
  is_steward(circle_id) or has_role(circle_id, 'contact_officer')
);

-- ---------------- roles ----------------
drop policy if exists roles_select on roles;
create policy roles_select on roles for select using (
  profile_id = auth.uid() or is_steward(circle_id)
);

drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using (is_steward(circle_id)) with check (is_steward(circle_id));

-- ---------------- assignments ----------------
drop policy if exists assignments_select on assignments;
create policy assignments_select on assignments for select using (
  is_steward_anywhere()
  or exists (select 1 from roles r where r.id = role_id and r.profile_id = auth.uid())
);

drop policy if exists assignments_write on assignments;
create policy assignments_write on assignments for all using (
  exists (select 1 from roles r where r.id = role_id and is_steward(r.circle_id))
) with check (
  exists (select 1 from roles r where r.id = role_id and is_steward(r.circle_id))
);

-- ---------------- sessions ----------------
drop policy if exists sessions_select on sessions;
create policy sessions_select on sessions for select using (
  in_circle(circle_id) or is_steward(circle_id)
);

drop policy if exists sessions_write on sessions;
create policy sessions_write on sessions for all using (
  is_steward(circle_id) or has_role(circle_id, 'attendance_officer')
) with check (
  is_steward(circle_id) or has_role(circle_id, 'attendance_officer')
);

-- ---------------- contacts_log ----------------
drop policy if exists contacts_select on contacts_log;
create policy contacts_select on contacts_log for select using (
  is_steward(session_circle(session_id)) or in_my_scope(student_id, 'contact_officer')
);

drop policy if exists contacts_insert on contacts_log;
create policy contacts_insert on contacts_log for insert with check (
  by_profile_id = auth.uid()
  and (in_my_scope(student_id, 'contact_officer') or is_steward(session_circle(session_id)))
);

-- ---------------- attendance ----------------
drop policy if exists attendance_select on attendance;
create policy attendance_select on attendance for select using (
  student_id = auth.uid()
  or is_steward(session_circle(session_id))
  or has_role(session_circle(session_id), 'attendance_officer')
);

drop policy if exists attendance_write on attendance;
create policy attendance_write on attendance for all using (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'attendance_officer')
) with check (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'attendance_officer')
);

-- ---------------- payments: محجوبة تمامًا عن غير المختصين ----------------
drop policy if exists payments_select on payments;
create policy payments_select on payments for select using (
  exists (
    select 1 from enrollments e
    where e.id = enrollment_id
      and (
        e.student_id = auth.uid()
        or is_steward(e.circle_id)
        or (has_role(e.circle_id, 'finance_officer') and in_my_scope(e.student_id, 'finance_officer'))
      )
  )
);

drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert with check (
  exists (
    select 1 from enrollments e
    where e.id = enrollment_id
      and (is_steward(e.circle_id) or has_role(e.circle_id, 'finance_officer'))
  )
);
-- لا توجد سياسة update أو delete: الإيصال لا يُعدَّل ولا يُحذف.

-- ---------------- tasks ----------------
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  in_circle(session_circle(session_id)) or is_steward(session_circle(session_id))
);

drop policy if exists tasks_write on tasks;
create policy tasks_write on tasks for all using (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'tasks_officer')
) with check (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'tasks_officer')
);

-- ---------------- task_progress ----------------
drop policy if exists progress_select on task_progress;
create policy progress_select on task_progress for select using (
  student_id = auth.uid()
  or is_steward_anywhere()
  or in_my_scope(student_id, 'tasks_officer')
);

drop policy if exists progress_write on task_progress;
create policy progress_write on task_progress for all using (
  student_id = auth.uid() or is_steward_anywhere() or in_my_scope(student_id, 'tasks_officer')
) with check (
  student_id = auth.uid() or is_steward_anywhere() or in_my_scope(student_id, 'tasks_officer')
);

-- ---------------- summaries ----------------
drop policy if exists summaries_select on summaries;
create policy summaries_select on summaries for select using (
  (status = 'published' and in_circle(session_circle(session_id)))
  or is_steward(session_circle(session_id))
  or has_role(session_circle(session_id), 'transcription_officer')
);

drop policy if exists summaries_write on summaries;
create policy summaries_write on summaries for all using (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'transcription_officer')
) with check (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'transcription_officer')
);

-- ---------------- wa_templates ----------------
drop policy if exists wa_select on wa_templates;
create policy wa_select on wa_templates for select using (
  circle_id is null or in_circle(circle_id) or is_steward_anywhere()
);

drop policy if exists wa_write on wa_templates;
create policy wa_write on wa_templates for all
  using (is_steward_anywhere()) with check (is_steward_anywhere());

-- ---------------- sheikh_notes: للشيخ والمدير فقط ----------------
drop policy if exists notes_all on sheikh_notes;
create policy notes_all on sheikh_notes for all
  using (is_steward_anywhere()) with check (is_steward_anywhere());

-- ---------------- audit_log: قراءة للمدير فقط، والكتابة عبر trigger ----------------
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select using (is_steward_anywhere());

-- >>>>>>>>>>>>>>>>>>>> migrations/0003_views.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — مناظر التقارير
-- 0003_views.sql
-- المناظر تحترم RLS تلقائيًا (security_invoker).
-- ============================================================

-- حالة التواصل لكل جلسة
create or replace view v_session_contacts
with (security_invoker = true) as
select
  s.id                               as session_id,
  s.circle_id,
  e.student_id,
  p.full_name,
  p.phone,
  c.outcome,
  c.contacted_at,
  c.by_profile_id
from sessions s
join enrollments e on e.circle_id = s.circle_id
join profiles p    on p.id = e.student_id
left join lateral (
  select * from contacts_log cl
  where cl.session_id = s.id and cl.student_id = e.student_id
  order by cl.contacted_at desc limit 1
) c on true;

-- ملخص الحضور لكل جلسة
create or replace view v_session_attendance_summary
with (security_invoker = true) as
select
  s.id as session_id,
  s.circle_id,
  s.held_at,
  count(*) filter (where a.state = 'present') as present,
  count(*) filter (where a.state = 'late')    as late,
  count(*) filter (where a.state = 'excused') as excused,
  count(*) filter (where a.state = 'absent')  as absent,
  (select count(*) from enrollments e where e.circle_id = s.circle_id) as enrolled
from sessions s
left join attendance a on a.session_id = s.id
group by s.id, s.circle_id, s.held_at;

-- حالة السداد لكل انتساب
create or replace view v_enrollment_balance
with (security_invoker = true) as
select
  e.id            as enrollment_id,
  e.circle_id,
  e.student_id,
  p.full_name,
  coalesce(fp.total_amount, 0)                       as due,
  coalesce(sum(pm.amount), 0)                        as paid,
  coalesce(fp.total_amount, 0) - coalesce(sum(pm.amount), 0) as remaining,
  max(pm.paid_at)                                    as last_paid_at
from enrollments e
join profiles p on p.id = e.student_id
left join fee_plans fp on fp.id = e.fee_plan_id
left join payments pm  on pm.enrollment_id = e.id
group by e.id, e.circle_id, e.student_id, p.full_name, fp.total_amount;

-- إنجاز التكاليف لكل جلسة
create or replace view v_task_completion
with (security_invoker = true) as
select
  t.id          as task_id,
  t.session_id,
  t.title,
  t.type,
  count(tp.*) filter (where tp.state = 'done')        as done,
  count(tp.*) filter (where tp.state = 'partial')     as partial,
  count(tp.*) filter (where tp.state = 'stalled')     as stalled,
  count(tp.*) filter (where tp.state = 'not_started') as not_started,
  (select count(*) from enrollments e
   join sessions s on s.id = t.session_id
   where e.circle_id = s.circle_id)                   as expected
from tasks t
left join task_progress tp on tp.task_id = t.id
group by t.id, t.session_id, t.title, t.type;

-- أداء الفريق: المُسنَد مقابل المُنجَز في كل مسؤولية
create or replace view v_officer_performance
with (security_invoker = true) as
select
  r.circle_id,
  r.profile_id,
  pr.full_name,
  r.role,
  count(a.*)                                     as scope_size,
  count(a.*) filter (
    where r.role = 'contact_officer' and exists (
      select 1 from contacts_log cl
      join sessions s on s.id = cl.session_id
      where cl.student_id = a.student_id
        and s.circle_id = r.circle_id
        and cl.contacted_at > now() - interval '7 days'
    )
  )                                              as contacted_7d,
  count(a.*) filter (
    where r.role = 'tasks_officer' and exists (
      select 1 from task_progress tp
      where tp.student_id = a.student_id
        and tp.updated_at > now() - interval '7 days'
    )
  )                                              as tasks_updated_7d,
  count(a.*) filter (
    where r.role = 'finance_officer' and exists (
      select 1 from v_enrollment_balance b
      where b.student_id = a.student_id
        and b.circle_id = r.circle_id
        and b.remaining <= 0
    )
  )                                              as settled
from roles r
join profiles pr on pr.id = r.profile_id
left join assignments a on a.role_id = r.id and a.revoked_at is null
where r.revoked_at is null
group by r.circle_id, r.profile_id, pr.full_name, r.role;

-- >>>>>>>>>>>>>>>>>>>> seed.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — بيانات ابتدائية
-- لا يحتاج أي مستخدم. إعادة تشغيله لا تكرر القوالب.
-- ============================================================

-- قوالب رسائل واتساب العامة (circle_id = null أي لكل المجالس)
insert into wa_templates (circle_id, key, label, body)
select v.circle_id, v.key, v.label, v.body
from (values
  (null::uuid, 'invite',  'دعوة أولى',
   'السلام عليكم ورحمة الله {اسم_الطالب}،
نسعد بدعوتك لحضور {اسم_المجلس} يوم {التاريخ} في {المكان}.
نرجو تأكيد الحضور.'),
  (null, 'remind',  'تذكير قبل المجلس',
   'تذكير بالخير {اسم_الطالب}،
{اسم_المجلس} غدًا بإذن الله في {المكان} — {التاريخ}.
بانتظارك.'),
  (null, 'absence', 'افتقاد بعد الغياب',
   'افتقدناك {اسم_الطالب} في {اسم_المجلس}.
نسأل الله أن يكون المانع خيرًا. هل نعينك في شيء؟'),
  (null, 'summary', 'نشر الملخص',
   'تفريغ وملخص {اسم_المجلس} متاح الآن:
{رابط_الملخص}'),
  (null, 'fee',     'تذكير بالرسوم',
   'السلام عليكم {اسم_الطالب}،
تذكير لطيف برسوم {اسم_المجلس}. جزاك الله خيرًا.'),
  (null, 'task',    'سؤال عن تكليف متعثر',
   'السلام عليكم {اسم_الطالب}،
نتابع معك تكليف هذا الأسبوع. هل واجهك ما يعين على تأخره؟')
) as v(circle_id, key, label, body)
where not exists (
  select 1 from wa_templates t where t.circle_id is null and t.key = v.key
);

-- >>>>>>>>>>>>>>>>>>>> migrations/0004_critical_fixes.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — إصلاحات حرجة
-- 0004_critical_fixes.sql
-- ١. إضافة طالب بلا حساب دخول (كانت معطّلة تمامًا)
-- ٢. لا يحذف الجلسات والتكاليف إلا المدير أو الشيخ
-- ٣. مسؤول التواصل لا يعدّل الانتساب ولا خطة الرسوم
-- ٤. مسؤول التفريغ لا ينشر ولا يعتمد بنفسه
-- آمن لإعادة التشغيل.
-- ============================================================

-- ---------- ١. الطالب بلا حساب دخول ----------
-- كان profiles.id مربوطًا بـ auth.users، فلا يمكن إنشاء ملف لطالب بلا حساب.
-- نفك الربط: من له حساب يبقى ملفه بنفس معرّف حسابه (handle_new_user)،
-- ومن لا حساب له يأخذ معرّفًا مستقلًا.
alter table profiles drop constraint if exists profiles_id_fkey;
alter table profiles alter column id set default gen_random_uuid();

-- الحفاظ على السلوك القديم: حذف حساب الدخول يحذف ملفه.
create or replace function handle_deleted_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from profiles where id = old.id;
  return old;
end $$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted after delete on auth.users
for each row execute function handle_deleted_user();

-- إضافة طالب وانتسابه في خطوة واحدة موثوقة.
-- مسؤول التواصل يدخل الطالب نطاقَه تلقائيًا حتى يراه ويتواصل معه.
create or replace function add_student(
  p_circle     uuid,
  p_full_name  text,
  p_phone      text default null,
  p_age        int  default null,
  p_university text default null,
  p_major      text default null,
  p_city       text default null,
  p_source     text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_role uuid;
begin
  if auth.uid() is null then
    raise exception 'يلزم تسجيل الدخول.' using errcode = '42501';
  end if;

  if not (is_steward(p_circle) or has_role(p_circle, 'contact_officer')) then
    raise exception 'لا تملك صلاحية إضافة طالب لهذا المجلس.' using errcode = '42501';
  end if;

  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'الاسم مطلوب.' using errcode = '22023';
  end if;

  insert into profiles (full_name, phone, age, university, major, city, source)
  values (
    btrim(p_full_name),
    nullif(btrim(p_phone), ''),
    p_age,
    nullif(btrim(p_university), ''),
    nullif(btrim(p_major), ''),
    nullif(btrim(p_city), ''),
    nullif(btrim(p_source), '')
  )
  returning id into v_id;

  insert into enrollments (circle_id, student_id) values (p_circle, v_id);

  select r.id into v_role
  from roles r
  where r.profile_id = auth.uid()
    and r.circle_id = p_circle
    and r.role = 'contact_officer'
    and r.revoked_at is null
  limit 1;

  if v_role is not null then
    insert into assignments (role_id, student_id, assigned_by)
    values (v_role, v_id, auth.uid());
  end if;

  return v_id;
end $$;

revoke all on function add_student(uuid, text, text, int, text, text, text, text) from public;
do $$ begin
  revoke all on function add_student(uuid, text, text, int, text, text, text, text) from anon;
  grant execute on function add_student(uuid, text, text, int, text, text, text, text) to authenticated;
exception when undefined_object then null; end $$;

-- ---------- ٢. الجلسات والتكاليف: الحذف للمدير والشيخ فقط ----------
-- حذف جلسة يمسح معها الحضور والتواصل والتكاليف والملخص.
drop policy if exists sessions_write  on sessions;
drop policy if exists sessions_insert on sessions;
drop policy if exists sessions_update on sessions;
drop policy if exists sessions_delete on sessions;

create policy sessions_insert on sessions for insert with check (
  is_steward(circle_id) or has_role(circle_id, 'attendance_officer')
);
create policy sessions_update on sessions for update using (
  is_steward(circle_id) or has_role(circle_id, 'attendance_officer')
) with check (
  is_steward(circle_id) or has_role(circle_id, 'attendance_officer')
);
create policy sessions_delete on sessions for delete using (is_steward(circle_id));

drop policy if exists tasks_write  on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_update on tasks;
drop policy if exists tasks_delete on tasks;

create policy tasks_insert on tasks for insert with check (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'tasks_officer')
);
create policy tasks_update on tasks for update using (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'tasks_officer')
) with check (
  is_steward(session_circle(session_id)) or has_role(session_circle(session_id), 'tasks_officer')
);
create policy tasks_delete on tasks for delete using (is_steward(session_circle(session_id)));

-- ---------- ٣. الانتساب وخطة الرسوم: للمدير والشيخ فقط ----------
-- مسؤول التواصل يضيف الطلاب عبر add_student، ولا يلمس fee_plan_id أو exempt_reason.
drop policy if exists enrollments_write on enrollments;
create policy enrollments_write on enrollments for all
  using (is_steward(circle_id)) with check (is_steward(circle_id));

-- ---------- ٤. الملخص: الاعتماد والنشر للمدير والشيخ فقط ----------
drop policy if exists summaries_write          on summaries;
drop policy if exists summaries_steward_write  on summaries;
drop policy if exists summaries_officer_insert on summaries;
drop policy if exists summaries_officer_update on summaries;

create policy summaries_steward_write on summaries for all
  using (is_steward(session_circle(session_id)))
  with check (is_steward(session_circle(session_id)));

-- مسؤول التفريغ: مسودة أو إرسال للاعتماد فقط، ولا يكتب حقول الاعتماد والنشر.
create policy summaries_officer_insert on summaries for insert with check (
  has_role(session_circle(session_id), 'transcription_officer')
  and status in ('draft', 'pending_review')
  and approved_by is null
  and published_at is null
);

-- ولا يعدّل ملخصًا اعتُمد أو نُشر.
create policy summaries_officer_update on summaries for update using (
  has_role(session_circle(session_id), 'transcription_officer')
  and status in ('draft', 'pending_review')
) with check (
  has_role(session_circle(session_id), 'transcription_officer')
  and status in ('draft', 'pending_review')
  and approved_by is null
  and published_at is null
);

-- >>>>>>>>>>>>>>>>>>>> migrations/0005_scoping_fees.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — حصر الصلاحيات بالمجلس، ونزاهة الرسوم
-- 0005_scoping_fees.sql
-- ١. مدير أو شيخ مجلس لا يرى بيانات مجلس آخر
-- ٢. الإيصال: مبلغ موجب، والقيد العكسي يساوي سالب الأصل ولا يتكرر، ولا تعديل
-- ٣. الإعفاء يُسقط المستحق في الرصيد
-- ٤. منظر إحصاء الحضور لكل طالب داخل المجلس
-- آمن لإعادة التشغيل.
-- ============================================================

-- ---------- دوال مساعدة ----------

-- هل أنا مدير/شيخ لأي مجلس ينتمي إليه هذا الشخص (طالبًا أو صاحب دور)؟
create or replace function is_steward_of_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e where e.student_id = p_profile and is_steward(e.circle_id)
  ) or exists (
    select 1 from roles r
    where r.profile_id = p_profile and r.revoked_at is null and is_steward(r.circle_id)
  );
$$;

-- حساب جديد لم يُضمّ لأي مجلس بعد: يراه المدير ليُسنِد له دورًا.
create or replace function is_unaffiliated_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from enrollments e where e.student_id = p_profile)
     and not exists (select 1 from roles r where r.profile_id = p_profile and r.revoked_at is null);
$$;

-- مجلس التكليف
create or replace function task_circle(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.circle_id from tasks t join sessions s on s.id = t.session_id where t.id = p_task;
$$;

-- ---------- ١. حصر الصلاحيات بالمجلس ----------

-- profiles
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or is_steward_of_profile(id)
  or (is_steward_anywhere() and is_unaffiliated_profile(id))
  or in_my_scope(id, 'contact_officer')
  or in_my_scope(id, 'attendance_officer')
  or in_my_scope(id, 'finance_officer')
  or in_my_scope(id, 'tasks_officer')
);

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (
  id = auth.uid() or is_steward_of_profile(id) or in_my_scope(id, 'contact_officer')
);

-- الطلاب بلا حساب يُضافون عبر add_student فقط.
drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert with check (id = auth.uid());

-- circles: المجلس الخاص لا يراه إلا أهله ومن يديره
drop policy if exists circles_select on circles;
create policy circles_select on circles for select using (
  type = 'public' or in_circle(id) or is_steward(id)
);

-- assignments
drop policy if exists assignments_select on assignments;
create policy assignments_select on assignments for select using (
  exists (
    select 1 from roles r
    where r.id = role_id and (r.profile_id = auth.uid() or is_steward(r.circle_id))
  )
);

-- task_progress: الطالب لنفسه داخل مجلسه، ومسؤول التكاليف لنطاقه داخل مجلسه، والمدير لمجلسه
drop policy if exists progress_select on task_progress;
create policy progress_select on task_progress for select using (
  student_id = auth.uid()
  or is_steward(task_circle(task_id))
  or (has_role(task_circle(task_id), 'tasks_officer') and in_my_scope(student_id, 'tasks_officer'))
);

drop policy if exists progress_write on task_progress;
create policy progress_write on task_progress for all using (
  (student_id = auth.uid() and in_circle(task_circle(task_id)))
  or is_steward(task_circle(task_id))
  or (has_role(task_circle(task_id), 'tasks_officer') and in_my_scope(student_id, 'tasks_officer'))
) with check (
  (student_id = auth.uid() and in_circle(task_circle(task_id)))
  or is_steward(task_circle(task_id))
  or (has_role(task_circle(task_id), 'tasks_officer') and in_my_scope(student_id, 'tasks_officer'))
);

-- wa_templates: القوالب العامة لأي مدير، وقوالب المجلس لمديره
drop policy if exists wa_select on wa_templates;
create policy wa_select on wa_templates for select using (
  circle_id is null or in_circle(circle_id) or is_steward(circle_id)
);

drop policy if exists wa_write on wa_templates;
create policy wa_write on wa_templates for all using (
  case when circle_id is null then is_steward_anywhere() else is_steward(circle_id) end
) with check (
  case when circle_id is null then is_steward_anywhere() else is_steward(circle_id) end
);

-- sheikh_notes: لمدير/شيخ مجلس الطالب فقط
drop policy if exists notes_all on sheikh_notes;
create policy notes_all on sheikh_notes for all
  using (is_steward_of_profile(student_id)) with check (is_steward_of_profile(student_id));

-- ---------- ٢. نزاهة الإيصالات ----------

-- قيد عكسي واحد لكل إيصال
create unique index if not exists uq_payment_reversal on payments(reversal_of) where reversal_of is not null;

create or replace function validate_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  orig payments%rowtype;
begin
  if new.reversal_of is null then
    if new.amount is null or new.amount <= 0 then
      raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر.' using errcode = '22023';
    end if;
  else
    select * into orig from payments where id = new.reversal_of;
    if not found then
      raise exception 'الإيصال الأصلي غير موجود.' using errcode = '22023';
    end if;
    if orig.reversal_of is not null then
      raise exception 'لا يُعكس قيد عكسي.' using errcode = '22023';
    end if;
    if orig.enrollment_id <> new.enrollment_id then
      raise exception 'القيد العكسي يكون على انتساب الإيصال الأصلي نفسه.' using errcode = '22023';
    end if;
    if new.amount <> -orig.amount then
      raise exception 'القيد العكسي يساوي سالب مبلغ الإيصال الأصلي.' using errcode = '22023';
    end if;
    if coalesce(btrim(new.note), '') = '' then
      raise exception 'اذكر سبب القيد العكسي.' using errcode = '22023';
    end if;
  end if;

  -- المحصِّل هو صاحب الجلسة، لا ما يرسله المتصفح
  new.collected_by := coalesce(auth.uid(), new.collected_by);
  return new;
end $$;

drop trigger if exists trg_validate_payment on payments;
create trigger trg_validate_payment before insert on payments
for each row execute function validate_payment();

create or replace function forbid_payment_update() returns trigger
language plpgsql as $$
begin
  raise exception 'لا يجوز تعديل إيصال. استخدم قيدًا عكسيًا (reversal_of).';
end $$;

drop trigger if exists trg_no_payment_update on payments;
create trigger trg_no_payment_update before update on payments
for each row execute function forbid_payment_update();

-- مسؤول الرسوم يحصّل من نطاقه فقط
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert with check (
  exists (
    select 1 from enrollments e
    where e.id = enrollment_id
      and (
        is_steward(e.circle_id)
        or (has_role(e.circle_id, 'finance_officer') and in_my_scope(e.student_id, 'finance_officer'))
      )
  )
);

-- ---------- ٣. الإعفاء يُسقط المستحق ----------
create or replace view v_enrollment_balance
with (security_invoker = true) as
select
  e.id            as enrollment_id,
  e.circle_id,
  e.student_id,
  p.full_name,
  case when e.exempt_reason is not null then 0 else coalesce(fp.total_amount, 0) end as due,
  coalesce(sum(pm.amount), 0)                        as paid,
  case when e.exempt_reason is not null then 0 else coalesce(fp.total_amount, 0) end
    - coalesce(sum(pm.amount), 0)                    as remaining,
  max(pm.paid_at)                                    as last_paid_at,
  e.fee_plan_id,
  e.exempt_reason
from enrollments e
join profiles p on p.id = e.student_id
left join fee_plans fp on fp.id = e.fee_plan_id
left join payments pm  on pm.enrollment_id = e.id
group by e.id, e.circle_id, e.student_id, p.full_name, fp.total_amount, e.fee_plan_id, e.exempt_reason;

-- ---------- ٤. إحصاء الحضور لكل طالب داخل المجلس ----------
-- بدل جلب كل سجل الحضور إلى المتصفح.
create or replace view v_student_attendance_stats
with (security_invoker = true) as
select
  s.circle_id,
  a.student_id,
  count(*)                                              as total,
  count(*) filter (where a.state in ('present', 'late')) as attended
from attendance a
join sessions s on s.id = a.session_id
group by s.circle_id, a.student_id;

-- >>>>>>>>>>>>>>>>>>>> migrations/0006_api_grants.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — صلاحيات واجهة البيانات
-- 0006_api_grants.sql
-- مشاريع Supabase الجديدة لا تمنح anon ولا authenticated أي صلاحية على الجداول افتراضيًا.
-- نمنح المستخدم المسجَّل فقط؛ وما يراه ويكتبه فعلًا تحكمه سياسات RLS.
-- الزائر غير المسجَّل (anon) لا يصل لأي جدول.
-- آمن لإعادة التشغيل.
-- ============================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- الدوال التي تستدعيها السياسات والواجهة
grant execute on function
  has_role(uuid, role_key),
  is_steward(uuid),
  is_steward_anywhere(),
  in_my_scope(uuid, role_key),
  in_circle(uuid),
  session_circle(uuid),
  is_steward_of_profile(uuid),
  is_unaffiliated_profile(uuid),
  task_circle(uuid),
  add_student(uuid, text, text, int, text, text, text, text)
to authenticated;

-- سجل التدقيق يُكتب من التريجر فقط، ولا يُعدَّل من الواجهة
revoke insert, update, delete on audit_log from authenticated;

-- الزائر لا يصل لشيء
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- الجداول والمناظر التي تُضاف لاحقًا تأخذ الصلاحيات نفسها تلقائيًا
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- >>>>>>>>>>>>>>>>>>>> migrations/0007_hardening.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — تقوية شاملة
-- 0007_hardening.sql
-- ١. إسناد النطاق: لا يُسنَد إلا طالب من نفس مجلس الدور (كان تسريبًا بين المجالس)
-- ٢. سجل التدقيق يُحصر بمجلسه
-- ٣. لا يُسحب آخر مدير في مجلس (يمنع القفل الذاتي)
-- ٤. حدود أطوال المدخلات (تمنع الإغراق وتكسير الواجهة)
-- ٥. منع تكرار التكليف نفسه في الجلسة
-- ٦. مسؤول الحضور يرى المؤكَّدين من التواصل (الشاشة تعتمد عليه)
-- ٧. التسجيل لا يفشل بسبب اسم طويل
-- آمن لإعادة التشغيل.
-- ============================================================

-- ---------- ٠. إسناد الأدوار للمدير وحده ----------
-- كان الشيخ يستطيع إسناد الأدوار فيرفع نفسه مديرًا (تصعيد صلاحيات). الآن:
-- الأدوار والنطاقات وإنشاء المجالس للمدير فقط، والشيخ يرى ويقرّر دون أن يمنح صلاحية.
create or replace function is_circle_admin(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles r
    where r.profile_id = auth.uid()
      and r.revoked_at is null
      and r.role = 'admin'
      and (r.circle_id = p_circle
           or p_circle in (select id from circles where parent_circle_id = r.circle_id))
  );
$$;

drop policy if exists roles_write on roles;
create policy roles_write on roles for all
  using (is_circle_admin(circle_id)) with check (is_circle_admin(circle_id));

drop policy if exists circles_write on circles;
create policy circles_write on circles for all
  using (is_circle_admin(id)) with check (is_circle_admin(id));

-- ---------- ١. إسناد النطاق ----------
drop policy if exists assignments_write on assignments;
create policy assignments_write on assignments for all using (
  exists (select 1 from roles r where r.id = assignments.role_id and is_circle_admin(r.circle_id))
) with check (
  exists (
    select 1
    from roles r
    join enrollments e on e.circle_id = r.circle_id and e.student_id = assignments.student_id
    where r.id = assignments.role_id and is_circle_admin(r.circle_id)
  )
);

-- ---------- ٢. سجل التدقيق بمجلسه ----------
alter table audit_log add column if not exists circle_id uuid;
create index if not exists idx_audit_circle on audit_log(circle_id, at desc);

create or replace function audit_circle_of(p_table text, p_row jsonb)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_table in ('roles', 'enrollments') then
    v := nullif(p_row->>'circle_id', '')::uuid;
  elsif p_table = 'assignments' then
    select circle_id into v from roles where id = nullif(p_row->>'role_id', '')::uuid;
  elsif p_table = 'payments' then
    select circle_id into v from enrollments where id = nullif(p_row->>'enrollment_id', '')::uuid;
  elsif p_table in ('attendance', 'summaries') then
    select circle_id into v from sessions where id = nullif(p_row->>'session_id', '')::uuid;
  elsif p_table = 'task_progress' then
    select s.circle_id into v
    from tasks t join sessions s on s.id = t.session_id
    where t.id = nullif(p_row->>'task_id', '')::uuid;
  end if;
  return v;
end $$;

create or replace function write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log(actor_id, entity, entity_id, action, before, after, circle_id)
  values (
    auth.uid(),
    tg_table_name,
    v_row->>'id',
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    audit_circle_of(tg_table_name, v_row)
  );
  return coalesce(new, old);
end $$;

drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select using (
  circle_id is not null and is_steward(circle_id)
);

-- السجل لا يُعدَّل ولا يُحذف من أحد (حتى المالك عبر الواجهة)
create or replace function forbid_audit_change() returns trigger
language plpgsql as $$
begin
  raise exception 'سجل التدقيق للقراءة فقط.';
end $$;

drop trigger if exists trg_audit_immutable on audit_log;
create trigger trg_audit_immutable before update or delete on audit_log
for each row execute function forbid_audit_change();

-- ---------- ٣. لا يُسحب آخر مدير ----------
create or replace function guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.revoked_at is null
     and (tg_op = 'DELETE' or new.revoked_at is not null or new.role <> 'admin' or new.circle_id <> old.circle_id)
     and exists (select 1 from circles c where c.id = old.circle_id)
     and not exists (
       select 1 from roles r
       where r.circle_id = old.circle_id and r.role = 'admin'
         and r.revoked_at is null and r.id <> old.id
     )
  then
    raise exception 'لا يمكن سحب آخر مدير في المجلس. أسنِد الإدارة لشخص آخر أولًا.' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_last_admin on roles;
create trigger trg_guard_last_admin before update or delete on roles
for each row execute function guard_last_admin();

-- ---------- ٤. حدود الأطوال ----------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('profiles',      'chk_profiles_len',      'char_length(full_name) between 1 and 120 and char_length(coalesce(phone, '''')) <= 30 and char_length(coalesce(university, '''')) <= 120 and char_length(coalesce(major, '''')) <= 120 and char_length(coalesce(city, '''')) <= 120 and char_length(coalesce(source, '''')) <= 200 and char_length(coalesce(notes, '''')) <= 2000'),
      ('circles',       'chk_circles_len',       'char_length(name) between 1 and 120 and char_length(coalesce(location, '''')) <= 200 and char_length(coalesce(schedule_rule, '''')) <= 200'),
      ('fee_plans',     'chk_fee_plans_len',     'char_length(name) between 1 and 120 and total_amount >= 0 and total_amount <= 100000000'),
      ('enrollments',   'chk_enrollments_len',   'char_length(coalesce(exempt_reason, '''')) <= 300'),
      ('sessions',      'chk_sessions_len',      'char_length(coalesce(title, '''')) <= 200 and char_length(coalesce(recording_url, '''')) <= 500'),
      ('contacts_log',  'chk_contacts_len',      'char_length(coalesce(note, '''')) <= 1000'),
      ('payments',      'chk_payments_len',      'char_length(coalesce(note, '''')) <= 500 and abs(amount) <= 100000000'),
      ('tasks',         'chk_tasks_len',         'char_length(title) between 1 and 300 and char_length(coalesce(description, '''')) <= 2000'),
      ('task_progress', 'chk_progress_len',      'char_length(coalesce(evidence_url, '''')) <= 500'),
      ('summaries',     'chk_summaries_len',     'char_length(coalesce(summary_md, '''')) <= 100000 and char_length(coalesce(transcript_url, '''')) <= 500'),
      ('wa_templates',  'chk_wa_templates_len',  'char_length(label) between 1 and 120 and char_length(body) between 1 and 2000'),
      ('sheikh_notes',  'chk_sheikh_notes_len',  'char_length(body) between 1 and 5000')
    ) as t(tbl, name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table %I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end $$;

-- روابط التسجيل والدليل: http/https فقط (تمنع javascript: وما شابهه إن عُرضت يومًا كرابط)
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('sessions',      'chk_session_url_http',  'recording_url is null or recording_url ~* ''^https?://'''),
      ('task_progress', 'chk_progress_url_http', 'evidence_url is null or evidence_url ~* ''^https?://'''),
      ('summaries',     'chk_summary_url_http',  'transcript_url is null or transcript_url ~* ''^https?://''')
    ) as t(tbl, name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table %I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end $$;

-- ---------- ٥. تكليف واحد لكل عنوان ونوع في الجلسة ----------
create unique index if not exists uq_tasks_session_type_title
  on tasks (session_id, type, lower(btrim(title)));

-- ---------- ٦. مسؤول الحضور يرى المؤكَّدين ----------
drop policy if exists contacts_select_attendance on contacts_log;
create policy contacts_select_attendance on contacts_log for select using (
  outcome = 'confirmed' and has_role(session_circle(session_id), 'attendance_officer')
);

-- ---------- ٧. التسجيل لا يفشل باسم طويل ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, phone)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'مستخدم'), 120),
    left(nullif(btrim(new.raw_user_meta_data->>'phone'), ''), 30)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- ٨. منظر الرصيد لا يُظهر الرسوم إلا لأهلها ----------
-- المنظر يعمل بصلاحية المستعلِم، فكان مسؤول التواصل يرى «المستحق» للطلاب في نطاقه
-- (الدفعات محجوبة عنه لكن مبلغ الخطة ظاهر). الآن: المدير/الشيخ، ومسؤول الرسوم
-- (ونطاقه يقيّده enrollments_select)، والطالب لرصيده فقط.
create or replace view v_enrollment_balance
with (security_invoker = true) as
select
  e.id            as enrollment_id,
  e.circle_id,
  e.student_id,
  p.full_name,
  case when e.exempt_reason is not null then 0 else coalesce(fp.total_amount, 0) end as due,
  coalesce(sum(pm.amount), 0)                        as paid,
  case when e.exempt_reason is not null then 0 else coalesce(fp.total_amount, 0) end
    - coalesce(sum(pm.amount), 0)                    as remaining,
  max(pm.paid_at)                                    as last_paid_at,
  e.fee_plan_id,
  e.exempt_reason
from enrollments e
join profiles p on p.id = e.student_id
left join fee_plans fp on fp.id = e.fee_plan_id
left join payments pm  on pm.enrollment_id = e.id
where is_steward(e.circle_id)
   or has_role(e.circle_id, 'finance_officer')
   or e.student_id = auth.uid()
group by e.id, e.circle_id, e.student_id, p.full_name, fp.total_amount, e.fee_plan_id, e.exempt_reason;

-- ---------- الصلاحيات للكائنات الجديدة ----------
-- ---------- ٩. الزائر لا ينفّذ أي دالة ----------
-- Supabase القياسي يمنح anon صلاحية تنفيذ كل دالة في public افتراضيًا (وPUBLIC أيضًا).
-- نسحبها من الجميع ثم نعيدها للمستخدم المسجَّل على الدوال التي تحتاجها السياسات والواجهة فقط.
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges revoke execute on functions from public;

grant execute on function
  has_role(uuid, role_key),
  is_steward(uuid),
  is_steward_anywhere(),
  in_my_scope(uuid, role_key),
  in_circle(uuid),
  session_circle(uuid),
  is_steward_of_profile(uuid),
  is_unaffiliated_profile(uuid),
  task_circle(uuid),
  is_circle_admin(uuid),
  audit_circle_of(text, jsonb),
  add_student(uuid, text, text, int, text, text, text, text)
to authenticated;

commit;
