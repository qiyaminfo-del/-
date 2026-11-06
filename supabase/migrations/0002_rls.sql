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
