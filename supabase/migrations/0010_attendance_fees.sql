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
