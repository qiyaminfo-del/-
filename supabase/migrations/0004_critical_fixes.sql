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
