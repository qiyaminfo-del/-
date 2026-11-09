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
