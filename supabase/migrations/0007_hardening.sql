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
