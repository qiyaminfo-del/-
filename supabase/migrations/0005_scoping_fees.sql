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
