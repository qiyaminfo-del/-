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
