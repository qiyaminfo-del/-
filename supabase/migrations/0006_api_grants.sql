-- ============================================================
-- منصة مجالس — صلاحيات واجهة البيانات
-- 0006_api_grants.sql
-- مشاريع Supabase الجديدة لا تمنح anon ولا authenticated أي صلاحية على الجداول افتراضيًا.
-- نمنح المستخدم المسجَّل فقط؛ وما يراه ويكتبه فعلًا تحكمه سياسات RLS.
-- الزائر غير المسجَّل (anon) لا يصل لأي جدول.
-- آمن لإعادة التشغيل.
-- ============================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- الدوال التي تستدعيها السياسات والواجهة
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
  add_student(uuid, text, text, int, text, text, text, text)
to authenticated;

-- سجل التدقيق يُكتب من التريجر فقط، ولا يُعدَّل من الواجهة
revoke insert, update, delete on audit_log from authenticated;

-- الزائر لا يصل لشيء
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- الجداول والمناظر التي تُضاف لاحقًا تأخذ الصلاحيات نفسها تلقائيًا
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
