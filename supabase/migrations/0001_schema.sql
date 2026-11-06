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
