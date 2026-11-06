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
