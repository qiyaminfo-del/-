-- ============================================================
-- منصة مجالس — تعيين أول مدير (مرة واحدة فقط)
-- شغّله بعد setup_all.sql، وبعد أن تنشئ حسابك من شاشة الدخول في التطبيق.
-- غيّر القيم الأربع في السطور المعلَّمة ثم اضغط Run.
-- ============================================================

do $$
declare
  v_email    text := 'you@example.com';        -- ← بريد حسابك الذي سجّلت به
  v_circle   text := 'المجلس العام';            -- ← اسم المجلس
  v_location text := 'المسجد';                  -- ← المكان
  v_schedule text := 'كل سبت ٨ مساءً';          -- ← الموعد المتكرر
  v_user   uuid;
  v_circle_id uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'لا يوجد حساب بالبريد %. أنشئ حسابك من التطبيق أولًا ثم أعد التشغيل.', v_email;
  end if;

  -- ملفه الشخصي يُنشأ تلقائيًا عند التسجيل؛ هذا احتياط لو سُجّل قبل تشغيل setup_all.sql
  insert into profiles (id, full_name)
  values (v_user, split_part(v_email, '@', 1))
  on conflict (id) do nothing;

  select id into v_circle_id from circles where name = v_circle limit 1;
  if v_circle_id is null then
    insert into circles (name, type, location, schedule_rule)
    values (v_circle, 'public', v_location, v_schedule)
    returning id into v_circle_id;
  end if;

  insert into roles (profile_id, circle_id, role)
  values (v_user, v_circle_id, 'admin')
  on conflict (profile_id, circle_id, role) do update set revoked_at = null;

  raise notice 'تم: % صار مديرًا لـ «%».', v_email, v_circle;
end $$;
