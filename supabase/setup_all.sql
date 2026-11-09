-- ============================================================
-- منصة مجالس — كل قاعدة البيانات في ملف واحد لمشروع Supabase جديد
-- الصقه كاملًا في SQL Editor ثم اضغط Run مرة واحدة.
-- يجمع بالترتيب: 0001 → 0002 → 0003 → seed → 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010
-- يعمل كمعاملة واحدة: إما ينجح كله أو لا يتغير شيء، وإعادة تشغيله آمنة.
-- مولَّد تلقائيًا بـ npm run db:bundle من supabase/migrations (آخرها 0010). لا تعدّله يدويًا.
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

-- >>>>>>>>>>>>>>>>>>>> migrations/0008_members_scope.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — الأعضاء والصلاحيات والمجموعات
-- 0008_members_scope.sql
-- ١. حسابات العاملين: اسم مستخدم، نوع الحساب، تعطيل (يُطبَّق في القاعدة نفسها)
-- ٢. مجموعات الطلاب
-- ٣. نطاق كل دور: «كل طلاب المجلس» أو طلاب/مجموعات محددة (يشمل الشيخ الآن)
-- ٤. كل سياسات بيانات الطلاب تمر عبر النطاق: كل عضو يرى ما أُسنِد إليه فقط
-- ٥. حماية أعمدة الحساب الحساسة من تعديل صاحبها
-- يحافظ على السلوك السابق: الشيخ ومسؤول الحضور الحاليّون «كل الطلاب» تلقائيًا.
-- آمن لإعادة التشغيل.
-- ============================================================

-- ---------- ١. أعمدة الحساب ----------
alter table profiles add column if not exists username text;
alter table profiles add column if not exists account_kind text not null default 'student';
alter table profiles add column if not exists disabled_at timestamptz;
alter table profiles add column if not exists disabled_by uuid references profiles(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_profiles_account_kind') then
    alter table profiles add constraint chk_profiles_account_kind check (account_kind in ('student', 'staff'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_profiles_username') then
    alter table profiles add constraint chk_profiles_username
      check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$') not valid;
  end if;
end $$;

create unique index if not exists uq_profiles_username on profiles (lower(username)) where username is not null;

-- الحساب الذي يُنشئه المدير يحمل app_metadata (لا يكتبه إلا الخادم بمفتاحه السري).
-- أي تسجيل ذاتي = «طالب» دائمًا، ولا يستطيع انتحال اسم مستخدم أو صفة عامل من user_metadata.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean := coalesce(new.raw_app_meta_data->>'account_kind', '') = 'staff';
begin
  insert into profiles(id, full_name, phone, username, account_kind)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'مستخدم'), 120),
    left(nullif(btrim(new.raw_user_meta_data->>'phone'), ''), 30),
    case when v_staff then lower(nullif(btrim(new.raw_app_meta_data->>'username'), '')) end,
    case when v_staff then 'staff' else 'student' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- المستخدم يعدّل بياناته العادية فقط؛ اسم المستخدم ونوع الحساب والتعطيل ليست له.
revoke insert, update on profiles from authenticated;
grant insert (id, full_name, phone, age, university, major, city, source, notes) on profiles to authenticated;
grant update (full_name, phone, age, university, major, city, source, notes) on profiles to authenticated;

-- ---------- الحساب النشط ----------
-- حساب معطّل يفقد كل صلاحياته فورًا، ولو بقي رمز دخوله صالحًا.
create or replace function me_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (select 1 from profiles where id = auth.uid() and disabled_at is not null);
$$;

create or replace function has_role(p_circle uuid, p_role role_key)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r
    where r.profile_id = auth.uid() and r.circle_id = p_circle and r.role = p_role and r.revoked_at is null
  );
$$;

create or replace function is_steward(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r
    where r.profile_id = auth.uid() and r.revoked_at is null and r.role in ('admin', 'sheikh')
      and (r.circle_id = p_circle or p_circle in (select id from circles where parent_circle_id = r.circle_id))
  );
$$;

create or replace function is_steward_anywhere()
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r where r.profile_id = auth.uid() and r.revoked_at is null and r.role in ('admin', 'sheikh')
  );
$$;

create or replace function is_circle_admin(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r
    where r.profile_id = auth.uid() and r.revoked_at is null and r.role = 'admin'
      and (r.circle_id = p_circle or p_circle in (select id from circles where parent_circle_id = r.circle_id))
  );
$$;

create or replace function is_admin_anywhere()
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r where r.profile_id = auth.uid() and r.revoked_at is null and r.role = 'admin'
  );
$$;

create or replace function in_circle(p_circle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and (
    exists (select 1 from enrollments e where e.student_id = auth.uid() and e.circle_id = p_circle)
    or exists (select 1 from roles r where r.profile_id = auth.uid() and r.circle_id = p_circle and r.revoked_at is null)
  );
$$;

-- ---------- ٢. مجموعات الطلاب ----------
create table if not exists student_groups (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (circle_id, name)
);

create table if not exists student_group_members (
  group_id uuid not null references student_groups(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, student_id)
);
create index if not exists idx_group_members_student on student_group_members(student_id);

create or replace function group_circle(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select circle_id from student_groups where id = p_group;
$$;

-- ---------- ٣. نطاق الدور ----------
alter table roles add column if not exists scope_all boolean;
-- الحاليّون: الشيخ ومسؤول الحضور والمدير كانوا يرون المجلس كله؛ يبقون كذلك.
update roles set scope_all = (role in ('admin', 'sheikh', 'attendance_officer')) where scope_all is null;

-- دور جديد بلا تحديد: الشيخ ومسؤول الحضور والمدير «كل الطلاب»، والبقية «لا أحد حتى يُسنَد».
create or replace function roles_default_scope() returns trigger
language plpgsql as $$
begin
  if new.scope_all is null then
    new.scope_all := new.role in ('admin', 'sheikh', 'attendance_officer');
  end if;
  return new;
end $$;

drop trigger if exists trg_roles_default_scope on roles;
create trigger trg_roles_default_scope before insert or update on roles
for each row execute function roles_default_scope();

alter table roles alter column scope_all set not null;

-- الإسناد لطالب أو لمجموعة كاملة (يتبعها أعضاؤها الحاليون والقادمون)
alter table assignments add column if not exists group_id uuid references student_groups(id) on delete cascade;
alter table assignments alter column student_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_assignment_target') then
    alter table assignments add constraint chk_assignment_target check (num_nonnulls(student_id, group_id) = 1);
  end if;
end $$;
create unique index if not exists uq_assignments_role_group on assignments(role_id, group_id) where group_id is not null;

-- هل يغطي أحد أدواري (المذكورة) هذا الطالب في هذا المجلس؟
create or replace function covers(p_circle uuid, p_roles role_key[], p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active() and exists (
    select 1 from roles r
    where r.profile_id = auth.uid()
      and r.revoked_at is null
      and r.role = any (p_roles)
      and (r.circle_id = p_circle or p_circle in (select id from circles where parent_circle_id = r.circle_id))
      and (
        r.scope_all
        or exists (
          select 1 from assignments a
          where a.role_id = r.id and a.revoked_at is null
            and (a.student_id = p_student
                 or a.group_id in (select gm.group_id from student_group_members gm where gm.student_id = p_student))
        )
      )
  );
$$;

-- من يرى بيانات هذا الطالب في هذا المجلس؟ المدير، أو أي عضو يغطيه دوره.
create or replace function sees_student(p_circle uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_circle_admin(p_circle)
      or covers(p_circle,
                array['sheikh', 'contact_officer', 'attendance_officer', 'finance_officer', 'tasks_officer']::role_key[],
                p_student);
$$;

-- يبقى in_my_scope للتوافق، لكن بالمعنى الجديد (طالب أو مجموعة أو كل المجلس)
create or replace function in_my_scope(p_student uuid, p_role role_key)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e
    where e.student_id = p_student and covers(e.circle_id, array[p_role]::role_key[], p_student)
  );
$$;

create or replace function sees_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments e where e.student_id = p_profile and sees_student(e.circle_id, p_profile))
      -- أسماء فريق المجلس يراها مديره وشيخه
      or exists (select 1 from roles r where r.profile_id = p_profile and r.revoked_at is null and is_steward(r.circle_id));
$$;

create or replace function can_edit_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from enrollments e
      where e.student_id = p_profile
        and (is_circle_admin(e.circle_id) or covers(e.circle_id, array['contact_officer']::role_key[], p_profile))
    )
    or exists (select 1 from roles r where r.profile_id = p_profile and r.revoked_at is null and is_circle_admin(r.circle_id));
$$;

-- ملاحظات الشيخ: مدير المجلس، أو شيخ يغطي الطالب
create or replace function notes_access(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e
    where e.student_id = p_student
      and (is_circle_admin(e.circle_id) or covers(e.circle_id, array['sheikh']::role_key[], p_student))
  );
$$;

-- هل أستطيع إدارة حساب هذا الشخص (كلمة مرور، تعطيل)؟
-- فقط إن كانت كل أدواره وانتساباته داخل مجالس أديرها، وليس أنا. يمنع مدير مجلس من السيطرة على
-- حساب شخص له صلاحيات في مجلس آخر.
create or replace function member_manageable(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select me_active()
     and p_target <> auth.uid()
     and (exists (select 1 from roles r where r.profile_id = p_target and r.revoked_at is null)
          or exists (select 1 from enrollments e where e.student_id = p_target))
     and not exists (select 1 from roles r where r.profile_id = p_target and r.revoked_at is null and not is_circle_admin(r.circle_id))
     and not exists (select 1 from enrollments e where e.student_id = p_target and not is_circle_admin(e.circle_id));
$$;

create or replace function set_member_disabled(p_target uuid, p_disabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not member_manageable(p_target) then
    raise exception 'لا تملك صلاحية إدارة هذا الحساب.' using errcode = '42501';
  end if;
  update profiles
     set disabled_at = case when p_disabled then coalesce(disabled_at, now()) end,
         disabled_by = case when p_disabled then auth.uid() end
   where id = p_target;
end $$;

-- ---------- ٤. السياسات ----------

-- profiles
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or sees_profile(id)
  or (is_admin_anywhere() and is_unaffiliated_profile(id))
);

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (id = auth.uid() or can_edit_profile(id));

-- enrollments: الانتساب وخطته للمدير
drop policy if exists enrollments_select on enrollments;
create policy enrollments_select on enrollments for select using (
  student_id = auth.uid() or sees_student(circle_id, student_id)
);
drop policy if exists enrollments_write on enrollments;
create policy enrollments_write on enrollments for all
  using (is_circle_admin(circle_id)) with check (is_circle_admin(circle_id));

-- assignments: طالب من نفس المجلس أو مجموعة من نفس المجلس
drop policy if exists assignments_write on assignments;
create policy assignments_write on assignments for all using (
  exists (select 1 from roles r where r.id = assignments.role_id and is_circle_admin(r.circle_id))
) with check (
  exists (
    select 1 from roles r
    where r.id = assignments.role_id
      and is_circle_admin(r.circle_id)
      and (
        (assignments.student_id is not null
          and exists (select 1 from enrollments e where e.circle_id = r.circle_id and e.student_id = assignments.student_id))
        or (assignments.group_id is not null and group_circle(assignments.group_id) = r.circle_id)
      )
  )
);

-- attendance
drop policy if exists attendance_select on attendance;
create policy attendance_select on attendance for select using (
  student_id = auth.uid()
  or is_circle_admin(session_circle(session_id))
  or covers(session_circle(session_id), array['attendance_officer', 'sheikh']::role_key[], student_id)
);
drop policy if exists attendance_write on attendance;
create policy attendance_write on attendance for all using (
  is_circle_admin(session_circle(session_id))
  or covers(session_circle(session_id), array['attendance_officer']::role_key[], student_id)
) with check (
  is_circle_admin(session_circle(session_id))
  or covers(session_circle(session_id), array['attendance_officer']::role_key[], student_id)
);

-- contacts_log
drop policy if exists contacts_select on contacts_log;
create policy contacts_select on contacts_log for select using (
  is_circle_admin(session_circle(session_id))
  or covers(session_circle(session_id), array['contact_officer', 'sheikh']::role_key[], student_id)
);
drop policy if exists contacts_select_attendance on contacts_log;
create policy contacts_select_attendance on contacts_log for select using (
  outcome = 'confirmed' and covers(session_circle(session_id), array['attendance_officer']::role_key[], student_id)
);
drop policy if exists contacts_insert on contacts_log;
create policy contacts_insert on contacts_log for insert with check (
  by_profile_id = auth.uid()
  and (is_circle_admin(session_circle(session_id))
       or covers(session_circle(session_id), array['contact_officer', 'sheikh']::role_key[], student_id))
);

-- payments
drop policy if exists payments_select on payments;
create policy payments_select on payments for select using (
  exists (
    select 1 from enrollments e
    where e.id = payments.enrollment_id
      and (e.student_id = auth.uid()
           or is_circle_admin(e.circle_id)
           or covers(e.circle_id, array['finance_officer', 'sheikh']::role_key[], e.student_id))
  )
);
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert with check (
  exists (
    select 1 from enrollments e
    where e.id = payments.enrollment_id
      and (is_circle_admin(e.circle_id) or covers(e.circle_id, array['finance_officer']::role_key[], e.student_id))
  )
);

-- task_progress
drop policy if exists progress_select on task_progress;
create policy progress_select on task_progress for select using (
  student_id = auth.uid()
  or is_circle_admin(task_circle(task_id))
  or covers(task_circle(task_id), array['tasks_officer', 'sheikh']::role_key[], student_id)
);
drop policy if exists progress_write on task_progress;
create policy progress_write on task_progress for all using (
  (student_id = auth.uid() and in_circle(task_circle(task_id)))
  or is_circle_admin(task_circle(task_id))
  or covers(task_circle(task_id), array['tasks_officer']::role_key[], student_id)
) with check (
  (student_id = auth.uid() and in_circle(task_circle(task_id)))
  or is_circle_admin(task_circle(task_id))
  or covers(task_circle(task_id), array['tasks_officer']::role_key[], student_id)
);

-- sheikh_notes
drop policy if exists notes_all on sheikh_notes;
create policy notes_all on sheikh_notes for all
  using (notes_access(student_id)) with check (notes_access(student_id));

-- audit_log: للمدير فقط
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select using (circle_id is not null and is_circle_admin(circle_id));

-- المجموعات
alter table student_groups enable row level security;
alter table student_group_members enable row level security;

drop policy if exists groups_select on student_groups;
create policy groups_select on student_groups for select using (in_circle(circle_id) or is_steward(circle_id));
drop policy if exists groups_write on student_groups;
create policy groups_write on student_groups for all
  using (is_circle_admin(circle_id)) with check (is_circle_admin(circle_id));

drop policy if exists group_members_select on student_group_members;
create policy group_members_select on student_group_members for select using (
  student_id = auth.uid() or sees_student(group_circle(group_id), student_id)
);
drop policy if exists group_members_write on student_group_members;
create policy group_members_write on student_group_members for all using (
  is_circle_admin(group_circle(group_id))
) with check (
  is_circle_admin(group_circle(group_id))
  and exists (select 1 from enrollments e where e.circle_id = group_circle(group_id) and e.student_id = student_group_members.student_id)
);

-- ---------- أداء الفريق: النطاق = الطلاب الذين يغطيهم الدور فعلًا ----------
create or replace view v_officer_performance
with (security_invoker = true) as
select
  r.circle_id,
  r.profile_id,
  pr.full_name,
  r.role,
  count(sc.student_id)                                    as scope_size,
  count(sc.student_id) filter (
    where r.role = 'contact_officer' and exists (
      select 1 from contacts_log cl join sessions s on s.id = cl.session_id
      where cl.student_id = sc.student_id and s.circle_id = r.circle_id
        and cl.contacted_at > now() - interval '7 days'
    )
  )                                                       as contacted_7d,
  count(sc.student_id) filter (
    where r.role = 'tasks_officer' and exists (
      select 1 from task_progress tp
      where tp.student_id = sc.student_id and tp.updated_at > now() - interval '7 days'
    )
  )                                                       as tasks_updated_7d,
  count(sc.student_id) filter (
    where r.role = 'finance_officer' and exists (
      select 1 from v_enrollment_balance b
      where b.student_id = sc.student_id and b.circle_id = r.circle_id and b.remaining <= 0
    )
  )                                                       as settled
from roles r
join profiles pr on pr.id = r.profile_id
left join lateral (
  select e.student_id from enrollments e
  where e.circle_id = r.circle_id
    and (
      r.scope_all
      or exists (
        select 1 from assignments a
        where a.role_id = r.id and a.revoked_at is null
          and (a.student_id = e.student_id
               or a.group_id in (select gm.group_id from student_group_members gm where gm.student_id = e.student_id))
      )
    )
) sc on true
where r.revoked_at is null
group by r.circle_id, r.profile_id, pr.full_name, r.role;

-- ---------- الصلاحيات ----------
grant select, insert, update, delete on student_groups, student_group_members to authenticated;
revoke all on student_groups, student_group_members from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  me_active(),
  has_role(uuid, role_key),
  is_steward(uuid),
  is_steward_anywhere(),
  is_circle_admin(uuid),
  is_admin_anywhere(),
  in_circle(uuid),
  in_my_scope(uuid, role_key),
  covers(uuid, role_key[], uuid),
  sees_student(uuid, uuid),
  sees_profile(uuid),
  can_edit_profile(uuid),
  notes_access(uuid),
  group_circle(uuid),
  member_manageable(uuid),
  set_member_disabled(uuid, boolean),
  session_circle(uuid),
  task_circle(uuid),
  is_steward_of_profile(uuid),
  is_unaffiliated_profile(uuid),
  audit_circle_of(text, jsonb),
  add_student(uuid, text, text, int, text, text, text, text)
to authenticated;

-- >>>>>>>>>>>>>>>>>>>> migrations/0009_wird_levels.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — مستويات متابعة الأوراد
-- 0009_wird_levels.sql
-- • عبادات مخصصة لكل مجلس بطريقة متابعة: تم/لم يتم، عدد، كمية
-- • مستويات مرنة بأي عدد، ولكل مستوى عباداته وهدف كل عبادة فيه
-- • مستوى لكل طالب مع سجل تاريخي: النقل لا يمحو ما قبله
-- • متابعة يومية تُحسب على أوراد مستوى الطالب في ذلك اليوم، لا على قائمة موحدة
-- يضيف جداول جديدة فقط. آمن لإعادة التشغيل.
-- ============================================================

do $$ begin
  create type wird_kind as enum ('check', 'count', 'amount');
exception when duplicate_object then null; end $$;

create table if not exists worship_items (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind wird_kind not null default 'check',
  unit text check (unit is null or char_length(unit) <= 20),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (circle_id, name)
);

create table if not exists wird_levels (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (circle_id, name)
);

create table if not exists wird_level_items (
  level_id uuid not null references wird_levels(id) on delete cascade,
  item_id uuid not null references worship_items(id) on delete restrict,
  -- الهدف للعدد والكمية (مثلًا ٥ صفحات)؛ فارغ = أي قيمة أكبر من صفر تكفي
  target numeric(10,2) check (target is null or (target > 0 and target <= 100000)),
  sort int not null default 0,
  primary key (level_id, item_id)
);

-- مستوى الطالب عبر الزمن: صف مفتوح واحد على الأكثر (الحالي)، والقديمة تبقى للسجل
create table if not exists student_levels (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  level_id uuid not null references wird_levels(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references profiles(id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists uq_student_level_active on student_levels(circle_id, student_id) where ended_at is null;
create index if not exists idx_student_levels_student on student_levels(student_id, started_at);

create table if not exists wird_logs (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null references worship_items(id) on delete restrict,
  day date not null,
  level_id uuid references wird_levels(id) on delete set null,
  done boolean,
  value numeric(10,2) check (value is null or (value >= 0 and value <= 100000)),
  recorded_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (student_id, item_id, day)
);
create index if not exists idx_wird_logs_circle_day on wird_logs(circle_id, day);

-- ---------- قواعد السلامة ----------

-- عبادات المستوى من نفس مجلسه
create or replace function check_level_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select circle_id from wird_levels where id = new.level_id)
     <> (select circle_id from worship_items where id = new.item_id) then
    raise exception 'العبادة ليست من مجلس هذا المستوى.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_level_item on wird_level_items;
create trigger trg_check_level_item before insert or update on wird_level_items
for each row execute function check_level_item();

-- مستوى الطالب في يوم بعينه: آخر نقل حدث حتى نهاية ذلك اليوم
create or replace function level_on_day(p_circle uuid, p_student uuid, p_day date)
returns uuid language sql stable security definer set search_path = public as $$
  select sl.level_id from student_levels sl
  where sl.circle_id = p_circle and sl.student_id = p_student
    -- لا يكشف مستوى طالب إلا لنفسه أو لمن يراه (أو للقاعدة نفسها بلا مستخدم)
    and (auth.uid() is null or p_student = auth.uid() or sees_student(p_circle, p_student))
    and sl.started_at::date <= p_day
    and (sl.ended_at is null or sl.ended_at::date > p_day)
  order by sl.started_at desc
  limit 1;
$$;

-- السجل اليومي: العبادة يجب أن تكون من مستوى الطالب في ذلك اليوم، والقيمة بحسب نوعها
create or replace function check_wird_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind wird_kind;
  v_level uuid;
begin
  select kind, circle_id into v_kind, new.circle_id from worship_items where id = new.item_id;
  if v_kind is null then
    raise exception 'العبادة غير موجودة.' using errcode = '22023';
  end if;
  if new.day > current_date + 1 then
    raise exception 'لا يُسجَّل ورد ليوم لم يأتِ بعد.' using errcode = '22023';
  end if;

  v_level := level_on_day(new.circle_id, new.student_id, new.day);
  if v_level is null or not exists (select 1 from wird_level_items where level_id = v_level and item_id = new.item_id) then
    raise exception 'هذه العبادة ليست من أوراد مستوى الطالب في ذلك اليوم.' using errcode = '22023';
  end if;
  new.level_id := v_level;

  if v_kind = 'check' then
    if new.done is null then raise exception 'حدّد: تم أم لم يتم.' using errcode = '22023'; end if;
    new.value := null;
  else
    if new.value is null then raise exception 'اكتب العدد أو الكمية.' using errcode = '22023'; end if;
    new.done := null;
  end if;

  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_check_wird_log on wird_logs;
create trigger trg_check_wird_log before insert or update on wird_logs
for each row execute function check_wird_log();

-- إسناد مستوى لطالب أو مجموعة أو الجميع، مع حفظ السابق في السجل
create or replace function assign_level(p_level uuid, p_students uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_circle uuid;
  v_student uuid;
  v_current uuid;
  v_count int := 0;
begin
  select circle_id into v_circle from wird_levels where id = p_level;
  if v_circle is null then
    raise exception 'المستوى غير موجود.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_students, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_students, 1) > 2000 then
    raise exception 'عدد كبير جدًا من الطلاب في طلب واحد.' using errcode = '22023';
  end if;

  foreach v_student in array p_students loop
    if not exists (select 1 from enrollments where circle_id = v_circle and student_id = v_student) then
      raise exception 'أحد الطلاب ليس منتسبًا لهذا المجلس.' using errcode = '22023';
    end if;
    if not (is_circle_admin(v_circle) or covers(v_circle, array['sheikh', 'tasks_officer']::role_key[], v_student)) then
      raise exception 'لا تملك صلاحية تعيين مستوى لأحد هؤلاء الطلاب.' using errcode = '42501';
    end if;

    select level_id into v_current from student_levels
    where circle_id = v_circle and student_id = v_student and ended_at is null
    for update;

    if v_current is distinct from p_level then
      update student_levels set ended_at = now()
      where circle_id = v_circle and student_id = v_student and ended_at is null;
      insert into student_levels (circle_id, student_id, level_id, assigned_by)
      values (v_circle, v_student, p_level, auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- إيقاف متابعة طالب (يبقى سجله)
create or replace function end_student_level(p_circle uuid, p_student uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_circle_admin(p_circle) or covers(p_circle, array['sheikh', 'tasks_officer']::role_key[], p_student)) then
    raise exception 'لا تملك صلاحية على هذا الطالب.' using errcode = '42501';
  end if;
  update student_levels set ended_at = now()
  where circle_id = p_circle and student_id = p_student and ended_at is null;
end $$;

-- ---------- تقرير الالتزام ----------
-- لكل طالب: المطلوب منه (أوراد مستواه في كل يوم) والمنجز منه. يعمل بصلاحية المستعلِم،
-- فلا يرى أحد إلا الطلاب المصرح له بهم.
create or replace function wird_report(p_circle uuid, p_from date, p_to date)
returns table (student_id uuid, full_name text, level_name text, required bigint, completed bigint, percent int)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_to < p_from then
    raise exception 'نهاية الفترة قبل بدايتها.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'الفترة أطول من سنة.' using errcode = '22023';
  end if;

  return query
  with days as (
    select d::date as day from generate_series(p_from, least(p_to, current_date), interval '1 day') d
  ),
  studs as (
    select e.student_id, p.full_name from enrollments e join profiles p on p.id = e.student_id
    where e.circle_id = p_circle
  ),
  req as (
    select s.student_id, dd.day, li.item_id, li.target, wi.kind
    from studs s
    cross join days dd
    join lateral (select level_on_day(p_circle, s.student_id, dd.day) as level_id) lv on lv.level_id is not null
    join wird_level_items li on li.level_id = lv.level_id
    join worship_items wi on wi.id = li.item_id
  ),
  scored as (
    select r.student_id,
           count(*) as required,
           count(*) filter (
             where (r.kind = 'check' and w.done)
                or (r.kind <> 'check' and w.value is not null
                    and ((r.target is null and w.value > 0) or (r.target is not null and w.value >= r.target)))
           ) as completed
    from req r
    left join wird_logs w on w.student_id = r.student_id and w.item_id = r.item_id and w.day = r.day
    group by r.student_id
  )
  select s.student_id, s.full_name,
         (select l.name from student_levels sl join wird_levels l on l.id = sl.level_id
           where sl.circle_id = p_circle and sl.student_id = s.student_id and sl.ended_at is null) as level_name,
         coalesce(sc.required, 0)::bigint,
         coalesce(sc.completed, 0)::bigint,
         case when coalesce(sc.required, 0) = 0 then null
              else round(100.0 * sc.completed / sc.required)::int end
  from studs s
  left join scored sc on sc.student_id = s.student_id
  order by 6 nulls last, 2;
end $$;

-- ---------- السياسات ----------
alter table worship_items enable row level security;
alter table wird_levels enable row level security;
alter table wird_level_items enable row level security;
alter table student_levels enable row level security;
alter table wird_logs enable row level security;

create or replace function level_circle(p_level uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select circle_id from wird_levels where id = p_level;
$$;

-- العبادات والمستويات: يقرؤها أهل المجلس، ويديرها المدير والشيخ
drop policy if exists worship_select on worship_items;
create policy worship_select on worship_items for select using (in_circle(circle_id) or is_steward(circle_id));
drop policy if exists worship_write on worship_items;
create policy worship_write on worship_items for all using (is_steward(circle_id)) with check (is_steward(circle_id));

drop policy if exists levels_select on wird_levels;
create policy levels_select on wird_levels for select using (in_circle(circle_id) or is_steward(circle_id));
drop policy if exists levels_write on wird_levels;
create policy levels_write on wird_levels for all using (is_steward(circle_id)) with check (is_steward(circle_id));

drop policy if exists level_items_select on wird_level_items;
create policy level_items_select on wird_level_items for select using (
  in_circle(level_circle(level_id)) or is_steward(level_circle(level_id))
);
drop policy if exists level_items_write on wird_level_items;
create policy level_items_write on wird_level_items for all
  using (is_steward(level_circle(level_id))) with check (is_steward(level_circle(level_id)));

-- مستوى الطالب: قراءة فقط؛ التغيير عبر assign_level وحده (يحفظ السجل)
drop policy if exists student_levels_select on student_levels;
create policy student_levels_select on student_levels for select using (
  student_id = auth.uid()
  or is_circle_admin(circle_id)
  or covers(circle_id, array['sheikh', 'tasks_officer']::role_key[], student_id)
);

-- السجل اليومي: الطالب لنفسه، ومسؤول الأوراد لمن يغطيه، والمدير
drop policy if exists wird_logs_select on wird_logs;
create policy wird_logs_select on wird_logs for select using (
  student_id = auth.uid()
  or is_circle_admin(circle_id)
  or covers(circle_id, array['sheikh', 'tasks_officer']::role_key[], student_id)
);
drop policy if exists wird_logs_write on wird_logs;
create policy wird_logs_write on wird_logs for all using (
  (student_id = auth.uid() and me_active())
  or is_circle_admin(circle_id)
  or covers(circle_id, array['tasks_officer']::role_key[], student_id)
) with check (
  (student_id = auth.uid() and me_active())
  or is_circle_admin(circle_id)
  or covers(circle_id, array['tasks_officer']::role_key[], student_id)
);

-- ---------- التدقيق والصلاحيات ----------
do $$
declare t text;
begin
  foreach t in array array['student_levels', 'wird_logs'] loop
    execute format('drop trigger if exists trg_audit_%1$s on %1$s', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on %1$s
                    for each row execute function write_audit()', t);
  end loop;
end $$;

grant select, insert, update, delete on worship_items, wird_levels, wird_level_items, wird_logs to authenticated;
grant select on student_levels to authenticated;
-- السجل التاريخي لا يُكتب مباشرة أبدًا: الإسناد عبر assign_level وحده
revoke insert, update, delete on student_levels from authenticated;
revoke all on worship_items, wird_levels, wird_level_items, student_levels, wird_logs from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  level_circle(uuid),
  level_on_day(uuid, uuid, date),
  assign_level(uuid, uuid[]),
  end_student_level(uuid, uuid),
  wird_report(uuid, date, date)
to authenticated;

-- >>>>>>>>>>>>>>>>>>>> migrations/0010_attendance_fees.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
-- منصة مجالس — الحضور بالوقت، والرسوم المستحقة
-- 0010_attendance_fees.sql
-- الحضور: وقت الوصول الفعلي بالدقيقة، ومن عدّل ومتى، وتقرير لكل طالب/مجموعة/فترة.
-- الرسوم: «رسوم مستحقة» متعددة لكل طالب بفترتها، دفع كامل أو جزئي بدفعات متعددة،
--         إعفاء كلي أو جزئي بسبب، حالة (مسددة/جزئية/غير مسددة/معفى)، ومنع تجاوز المتبقي
--         ومنع تكرار الدفعة. تُنقل الخطط والإعفاءات والدفعات القديمة تلقائيًا بلا فقد.
-- آمن لإعادة التشغيل.
-- ============================================================

-- ============================ الحضور ============================
alter table attendance add column if not exists arrived_at timestamptz;
alter table attendance add column if not exists updated_by uuid references profiles(id);
alter table attendance add column if not exists updated_at timestamptz;

create or replace function stamp_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_held timestamptz;
begin
  if tg_op = 'INSERT' then
    new.marked_by := coalesce(auth.uid(), new.marked_by);
    new.marked_at := coalesce(new.marked_at, now());
    new.updated_by := null;
    new.updated_at := null;
  else
    -- من سجّل أول مرة ومتى لا يتغيران؛ التعديل يُختم باسم من أجراه ووقته
    new.marked_by := old.marked_by;
    new.marked_at := old.marked_at;
    if row(new.state, new.arrived_at) is distinct from row(old.state, old.arrived_at) then
      new.updated_by := coalesce(auth.uid(), new.updated_by);
      new.updated_at := now();
    else
      new.updated_by := old.updated_by;
      new.updated_at := old.updated_at;
    end if;
  end if;

  -- وقت الوصول للحاضر والمتأخر فقط، وبدقة الدقيقة، وقريب من موعد الجلسة
  if new.state in ('absent', 'excused') then
    new.arrived_at := null;
  elsif new.arrived_at is not null then
    new.arrived_at := date_trunc('minute', new.arrived_at);
    select held_at into v_held from sessions where id = new.session_id;
    if new.arrived_at < v_held - interval '12 hours' or new.arrived_at > v_held + interval '12 hours' then
      raise exception 'وقت الوصول بعيد عن موعد الجلسة.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_attendance on attendance;
create trigger trg_stamp_attendance before insert or update on attendance
for each row execute function stamp_attendance();

-- تقرير الحضور: لكل طالب في فترة (واختياريًا مجموعة). بصلاحية المستعلِم.
create or replace function attendance_report(p_circle uuid, p_from date, p_to date, p_group uuid default null)
returns table (
  student_id uuid, full_name text, sessions bigint, present bigint, late bigint,
  excused bigint, absent bigint, unmarked bigint, rate int, avg_late_minutes int
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_to < p_from then
    raise exception 'نهاية الفترة قبل بدايتها.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'الفترة أطول من سنة.' using errcode = '22023';
  end if;

  return query
  with ses as (
    select s.id, s.held_at from sessions s
    where s.circle_id = p_circle
      and s.held_at::date between p_from and p_to
      and s.held_at <= now()
  ),
  studs as (
    select e.student_id, p.full_name from enrollments e join profiles p on p.id = e.student_id
    where e.circle_id = p_circle
      and (p_group is null or exists (
        select 1 from student_group_members gm where gm.group_id = p_group and gm.student_id = e.student_id))
  ),
  grid as (
    select st.student_id, st.full_name, se.id as session_id, se.held_at, a.state, a.arrived_at
    from studs st
    cross join ses se
    left join attendance a on a.session_id = se.id and a.student_id = st.student_id
  )
  select st.student_id, st.full_name,
         count(g.session_id),
         count(*) filter (where g.state = 'present'),
         count(*) filter (where g.state = 'late'),
         count(*) filter (where g.state = 'excused'),
         count(*) filter (where g.state = 'absent'),
         count(g.session_id) filter (where g.state is null),
         case when count(g.session_id) = 0 then null
              else round(100.0 * count(*) filter (where g.state in ('present', 'late')) / count(g.session_id))::int end,
         round(avg(extract(epoch from (g.arrived_at - g.held_at)) / 60)
               filter (where g.state = 'late' and g.arrived_at is not null))::int
  from studs st
  left join grid g on g.student_id = st.student_id
  group by st.student_id, st.full_name
  order by 9 nulls last, 2;
end $$;

-- ============================ الرسوم ============================
create table if not exists fee_dues (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete restrict,
  fee_plan_id uuid references fee_plans(id) on delete set null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  period_start date,
  period_end date,
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000000),
  exempt_amount numeric(12,2) not null default 0,
  exempt_reason text check (exempt_reason is null or char_length(exempt_reason) <= 300),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz,
  check (period_end is null or period_start is null or period_end >= period_start),
  check (exempt_amount >= 0 and exempt_amount <= amount),
  check (exempt_amount = 0 or coalesce(btrim(exempt_reason), '') <> '')
);
create index if not exists idx_fee_dues_enrollment on fee_dues(enrollment_id);
-- لا تُحسب خطة واحدة مرتين لنفس الطالب ونفس الفترة
create unique index if not exists uq_fee_dues_plan_period
  on fee_dues (enrollment_id, fee_plan_id, coalesce(period_start, date '0001-01-01'))
  where fee_plan_id is not null;

alter table payments add column if not exists due_id uuid references fee_dues(id) on delete restrict;
-- معرّف يولّده المتصفح لكل محاولة دفع: الضغط المزدوج أو إعادة الإرسال لا تسجّل الدفعة مرتين
alter table payments add column if not exists client_ref uuid;
create unique index if not exists uq_payments_client_ref on payments(client_ref) where client_ref is not null;
create index if not exists idx_payments_due on payments(due_id);

create or replace function due_paid(p_due uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.amount), 0) from payments p
  where p.due_id = p_due
    -- لا يكشف مدفوعات رسوم إلا لصاحبها أو لمن يدير رسومه (أو للقاعدة نفسها بلا مستخدم)
    and (auth.uid() is null or exists (
      select 1 from fee_dues d join enrollments e on e.id = d.enrollment_id
      where d.id = p_due
        and (e.student_id = auth.uid() or is_circle_admin(e.circle_id)
             or covers(e.circle_id, array['finance_officer', 'sheikh']::role_key[], e.student_id))
    ));
$$;

create or replace function stamp_fee_due() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    if new.enrollment_id <> old.enrollment_id then
      raise exception 'لا يُنقل استحقاق من طالب إلى آخر.' using errcode = '22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
    v_paid := due_paid(new.id);
    if v_paid > new.amount - new.exempt_amount then
      raise exception 'المدفوع (%) أكبر من الصافي المستحق بعد التعديل (%). اعكس دفعة أولًا.',
        v_paid, new.amount - new.exempt_amount using errcode = '23514';
    end if;
  end if;
  if new.exempt_amount = 0 then
    new.exempt_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_fee_due on fee_dues;
create trigger trg_stamp_fee_due before insert or update on fee_dues
for each row execute function stamp_fee_due();

create or replace function guard_fee_due_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from payments where due_id = old.id) then
    raise exception 'لا تُحذف رسوم عليها دفعات. اعكس الدفعات أولًا أو عدّل المبلغ.' using errcode = '23503';
  end if;
  return old;
end $$;

drop trigger if exists trg_guard_fee_due_delete on fee_dues;
create trigger trg_guard_fee_due_delete before delete on fee_dues
for each row execute function guard_fee_due_delete();

-- الدفعة: على رسوم بعينها، ولا تتجاوز المتبقي منها
create or replace function validate_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  orig payments%rowtype;
  d fee_dues%rowtype;
  v_paid numeric;
  v_net numeric;
begin
  if new.reversal_of is null then
    if new.amount is null or new.amount <= 0 then
      raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر.' using errcode = '22023';
    end if;
    if new.due_id is null then
      raise exception 'اختر الرسوم المستحقة التي تُسدَّد بهذه الدفعة.' using errcode = '22023';
    end if;
    -- قفل الاستحقاق يمنع دفعتين متزامنتين من تجاوز المتبقي معًا
    select * into d from fee_dues where id = new.due_id for update;
    if not found or d.enrollment_id <> new.enrollment_id then
      raise exception 'الرسوم المختارة لا تخص هذا الطالب.' using errcode = '22023';
    end if;
    v_paid := due_paid(new.due_id);
    v_net := d.amount - d.exempt_amount;
    if v_paid + new.amount > v_net then
      raise exception 'المبلغ (%) أكبر من المتبقي (%).', new.amount, greatest(v_net - v_paid, 0) using errcode = '23514';
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
    new.due_id := orig.due_id;
  end if;

  new.collected_by := coalesce(auth.uid(), new.collected_by);
  return new;
end $$;

-- الإيصال لا يُعدَّل، إلا ربط دفعة قديمة غير مربوطة برسومها (مرة واحدة، دون مسّ أي حقل آخر)
create or replace function forbid_payment_update() returns trigger
language plpgsql as $$
begin
  if old.due_id is null and new.due_id is not null
     and (to_jsonb(new) - 'due_id') = (to_jsonb(old) - 'due_id') then
    return new;
  end if;
  raise exception 'لا يجوز تعديل إيصال. استخدم قيدًا عكسيًا (reversal_of).';
end $$;

-- ---------- نقل البيانات القديمة بلا فقد ----------
-- كل انتساب له خطة: يصبح له استحقاق بمبلغ الخطة، والإعفاء القديم إعفاء كامل بسببه
insert into fee_dues (enrollment_id, fee_plan_id, label, amount, exempt_amount, exempt_reason)
select e.id, e.fee_plan_id, fp.name, fp.total_amount,
       case when e.exempt_reason is not null then fp.total_amount else 0 end,
       e.exempt_reason
from enrollments e
join fee_plans fp on fp.id = e.fee_plan_id
where fp.total_amount > 0
  and not exists (select 1 from fee_dues d where d.enrollment_id = e.id);

-- الدفعات القديمة تُربط باستحقاق انتسابها إن كان له استحقاق واحد
update payments pm set due_id = d.id
from fee_dues d
where pm.due_id is null
  and d.enrollment_id = pm.enrollment_id
  and (select count(*) from fee_dues x where x.enrollment_id = pm.enrollment_id) = 1;

-- ---------- العرض ----------
create or replace view v_fee_dues
with (security_invoker = true) as
select
  d.id, d.enrollment_id, e.circle_id, e.student_id, p.full_name,
  d.fee_plan_id, d.label, d.period_start, d.period_end,
  d.amount, d.exempt_amount, d.exempt_reason,
  d.amount - d.exempt_amount                                  as net,
  coalesce(pm.paid, 0)                                         as paid,
  d.amount - d.exempt_amount - coalesce(pm.paid, 0)            as remaining,
  case
    when d.exempt_amount >= d.amount then 'exempt'
    when coalesce(pm.paid, 0) >= d.amount - d.exempt_amount then 'paid'
    when coalesce(pm.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                                          as status,
  pm.last_paid_at,
  d.created_at
from fee_dues d
join enrollments e on e.id = d.enrollment_id
join profiles p on p.id = e.student_id
left join lateral (
  select sum(x.amount) as paid, max(x.paid_at) as last_paid_at from payments x where x.due_id = d.id
) pm on true;

-- الرصيد لكل طالب = مجموع الاستحقاقات الصافية − كل ما دُفع (الأعمدة القديمة كما هي، والجديدة في آخرها)
create or replace view v_enrollment_balance
with (security_invoker = true) as
select
  e.id                                                         as enrollment_id,
  e.circle_id,
  e.student_id,
  p.full_name,
  coalesce(d.net, 0)                                           as due,
  coalesce(pm.paid, 0)                                         as paid,
  coalesce(d.net, 0) - coalesce(pm.paid, 0)                    as remaining,
  pm.last_paid_at,
  e.fee_plan_id,
  e.exempt_reason,
  coalesce(d.exempted, 0)                                      as exempted,
  coalesce(d.cnt, 0)                                           as dues_count,
  case
    when coalesce(d.cnt, 0) = 0 then 'none'
    when d.exempted >= d.gross then 'exempt'
    when coalesce(pm.paid, 0) >= coalesce(d.net, 0) then 'paid'
    when coalesce(pm.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                                          as status
from enrollments e
join profiles p on p.id = e.student_id
left join lateral (
  select sum(x.amount - x.exempt_amount) as net, sum(x.exempt_amount) as exempted,
         sum(x.amount) as gross, count(*) as cnt
  from fee_dues x where x.enrollment_id = e.id
) d on true
left join lateral (
  select sum(y.amount) as paid, max(y.paid_at) as last_paid_at from payments y where y.enrollment_id = e.id
) pm on true
where is_circle_admin(e.circle_id)
   or covers(e.circle_id, array['finance_officer', 'sheikh']::role_key[], e.student_id)
   or e.student_id = auth.uid();

-- إنشاء استحقاقات خطة لطلاب كثيرين دفعة واحدة (المكرر يُتجاهل)
create or replace function create_plan_dues(
  p_plan uuid, p_period_start date default null, p_period_end date default null, p_students uuid[] default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_plan fee_plans%rowtype;
  v_count int;
begin
  select * into v_plan from fee_plans where id = p_plan;
  if not found then
    raise exception 'الخطة غير موجودة.' using errcode = '22023';
  end if;
  if v_plan.total_amount <= 0 then
    raise exception 'مبلغ الخطة يجب أن يكون أكبر من صفر.' using errcode = '22023';
  end if;
  if not (is_circle_admin(v_plan.circle_id) or has_role(v_plan.circle_id, 'finance_officer')) then
    raise exception 'لا تملك صلاحية إنشاء رسوم في هذا المجلس.' using errcode = '42501';
  end if;

  insert into fee_dues (enrollment_id, fee_plan_id, label, period_start, period_end, amount)
  select e.id, v_plan.id, v_plan.name, p_period_start, p_period_end, v_plan.total_amount
  from enrollments e
  where e.circle_id = v_plan.circle_id
    and (p_students is null or e.student_id = any (p_students))
    and (is_circle_admin(e.circle_id) or covers(e.circle_id, array['finance_officer']::role_key[], e.student_id))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- السياسات ----------
alter table fee_dues enable row level security;

create or replace function enrollment_access(p_enrollment uuid, p_roles role_key[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enrollments e
    where e.id = p_enrollment
      and (is_circle_admin(e.circle_id) or covers(e.circle_id, p_roles, e.student_id))
  );
$$;

drop policy if exists fee_dues_select on fee_dues;
create policy fee_dues_select on fee_dues for select using (
  exists (select 1 from enrollments e where e.id = fee_dues.enrollment_id and e.student_id = auth.uid())
  or enrollment_access(enrollment_id, array['finance_officer', 'sheikh']::role_key[])
);
drop policy if exists fee_dues_write on fee_dues;
create policy fee_dues_write on fee_dues for all
  using (enrollment_access(enrollment_id, array['finance_officer']::role_key[]))
  with check (enrollment_access(enrollment_id, array['finance_officer']::role_key[]));

-- ---------- التدقيق ----------
create or replace function audit_circle_of(p_table text, p_row jsonb)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_table in ('roles', 'enrollments', 'student_levels', 'wird_logs') then
    v := nullif(p_row->>'circle_id', '')::uuid;
  elsif p_table = 'assignments' then
    select circle_id into v from roles where id = nullif(p_row->>'role_id', '')::uuid;
  elsif p_table in ('payments', 'fee_dues') then
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

drop trigger if exists trg_audit_fee_dues on fee_dues;
create trigger trg_audit_fee_dues after insert or update or delete on fee_dues
for each row execute function write_audit();

-- ---------- الصلاحيات ----------
grant select, insert, update, delete on fee_dues to authenticated;
grant select on v_fee_dues to authenticated;
revoke all on fee_dues, v_fee_dues from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  attendance_report(uuid, date, date, uuid),
  due_paid(uuid),
  create_plan_dues(uuid, date, date, uuid[]),
  enrollment_access(uuid, role_key[]),
  audit_circle_of(text, jsonb)
to authenticated;

commit;
