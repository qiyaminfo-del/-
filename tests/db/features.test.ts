// @vitest-environment node
/**
 * اختبارات الميزات الجديدة على Postgres حقيقي:
 * الأعضاء والنطاق والمجموعات والتعطيل، ومستويات الأوراد، والحضور بالوقت، والرسوم المستحقة،
 * ونقل البيانات القديمة بلا فقد.
 *   TEST_DATABASE_URL=postgres://... npm run test:db
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, Harness, attempt, id, ok, setupSql } from './harness';

const suite = ADMIN_URL ? describe : describe.skip;
const h = new Harness();

const U = {
  admin: id(1), adminB: id(2), sheikhScoped: id(3), sheikhAll: id(4), att: id(5),
  fin: id(6), tasks: id(7), student: id(8), outsider: id(9),
};
const C = { A: id(100), B: id(101) };
const S = { s1: id(201), s2: id(202), s3: id(203), sB: id(204) };
const G = { G1: id(300), GB: id(301) };
const R = { admin: id(400), adminB: id(401), shS: id(402), shA: id(403), att: id(404), fin: id(405), tasks: id(406) };
const SES = { A: id(500), B: id(501) };
const E = { s1: id(600), s2: id(601), s3: id(602), student: id(603), sB: id(604) };
const FP = { A: id(700) };

async function seed(db: Client) {
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  for (const [name, uid] of Object.entries(U)) {
    await q('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [uid, `${name}@t.local`, JSON.stringify({ full_name: name })]);
  }
  await q("insert into circles(id,name) values ($1,'أ'),($2,'ب')", [C.A, C.B]);
  for (const [sid, n] of [[S.s1, 'طالب١'], [S.s2, 'طالب٢'], [S.s3, 'طالب٣'], [S.sB, 'طالب ب']]) {
    await q('insert into profiles(id,full_name) values ($1,$2)', [sid, n]);
  }
  await q(
    'insert into enrollments(id,circle_id,student_id) values ($1,$6,$2),($3,$6,$4),($5,$6,$7),($8,$6,$9),($10,$11,$12)',
    [E.s1, S.s1, E.s2, S.s2, E.s3, C.A, S.s3, E.student, U.student, E.sB, C.B, S.sB],
  );
  await q("insert into student_groups(id,circle_id,name) values ($1,$2,'الحلقة الأولى'),($3,$4,'حلقة ب')", [G.G1, C.A, G.GB, C.B]);
  await q('insert into student_group_members(group_id,student_id) values ($1,$2),($1,$3)', [G.G1, S.s1, S.s2]);
  const roles: [string, string, string, string, boolean | null][] = [
    [R.admin, U.admin, C.A, 'admin', null],
    [R.adminB, U.adminB, C.B, 'admin', null],
    [R.shS, U.sheikhScoped, C.A, 'sheikh', false],
    [R.shA, U.sheikhAll, C.A, 'sheikh', null],
    [R.att, U.att, C.A, 'attendance_officer', false],
    [R.fin, U.fin, C.A, 'finance_officer', null],
    [R.tasks, U.tasks, C.A, 'tasks_officer', true],
  ];
  for (const [rid, pid, cid, role, all] of roles) {
    await q('insert into roles(id,profile_id,circle_id,role,scope_all) values ($1,$2,$3,$4,$5)', [rid, pid, cid, role, all]);
  }
  await q('insert into assignments(role_id,group_id) values ($1,$3),($2,$3)', [R.shS, R.att, G.G1]);
  await q('insert into assignments(role_id,student_id) values ($1,$2)', [R.fin, S.s1]);
  // بدقة الدقيقة: وقت الوصول يُقرَّب للدقيقة، فحساب دقائق التأخير يبقى دقيقًا
  await q("insert into sessions(id,circle_id,held_at) values ($1,$2,date_trunc('minute', now()) - interval '1 hour'),($3,$4,now())", [SES.A, C.A, SES.B, C.B]);
  await q("insert into fee_plans(id,circle_id,name,total_amount) values ($1,$2,'الفصل الأول',300)", [FP.A, C.A]);
  await q("insert into sheikh_notes(student_id,body) values ($1,'م١'),($2,'م٣')", [S.s1, S.s3]);
}

beforeAll(async () => {
  if (!ADMIN_URL) return;
  await h.open('majales_feat');
  await seed(h.db);
});
afterAll(async () => {
  if (ADMIN_URL) await h.close();
});

// =================================================================
suite('حسابات الأعضاء', () => {
  it('التسجيل الذاتي «طالب» دائمًا ولا ينتحل اسم مستخدم أو صفة عامل من user_metadata', async () => {
    await h.sup(async (c) => {
      await c.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [
        id(901), 'hacker@x.com', JSON.stringify({ full_name: 'مخترق', username: 'admin', account_kind: 'staff' }),
      ]);
      const { rows } = await c.query('select username, account_kind from profiles where id=$1', [id(901)]);
      expect(rows[0]).toEqual({ username: null, account_kind: 'student' });
    });
  });

  it('الحساب الذي ينشئه الخادم (app_metadata) يحمل اسم المستخدم بأحرف صغيرة وصفة «عامل»', async () => {
    await h.sup(async (c) => {
      await c.query('insert into auth.users(id,email,raw_app_meta_data) values ($1,$2,$3)', [
        id(902), 'ahmed@majales.local', JSON.stringify({ username: 'Ahmed.Ali', account_kind: 'staff' }),
      ]);
      const { rows } = await c.query('select username, account_kind from profiles where id=$1', [id(902)]);
      expect(rows[0]).toEqual({ username: 'ahmed.ali', account_kind: 'staff' });
    });
  });

  it('اسم المستخدم فريد بلا اعتبار لحالة الأحرف، وبصيغة محددة', async () => {
    await h.sup(async (c) => {
      await c.query("update profiles set username='omar' where id=$1", [U.att]);
      const dup = await attempt(c, "update profiles set username='omar' where id=$1", [U.fin]);
      expect(!dup.ok && dup.error.code).toBe('23505');
      const bad = await attempt(c, "update profiles set username='a b' where id=$1", [U.fin]);
      expect(!bad.ok && bad.error.code).toBe('23514');
    });
  });

  it('المستخدم يعدّل اسمه وهاتفه فقط، لا اسم المستخدم ولا صفته ولا التعطيل', async () => {
    await h.mustAffect(U.outsider, "update profiles set full_name='اسم جديد' where id=$1", [U.outsider]);
    for (const col of ["username='boss'", "account_kind='staff'", 'disabled_at=null', "disabled_by=id"]) {
      await h.mustFail(U.outsider, `update profiles set ${col} where id=$1`, [U.outsider], /permission denied/);
    }
  });

  it('لا يمكن إنشاء ملف شخصي معطّل أو «عامل» بالإدخال المباشر', async () => {
    await h.mustFail(U.outsider, "insert into profiles(id,full_name,account_kind) values ($1,'x','staff')", [U.outsider], /permission denied/);
  });
});

// =================================================================
suite('النطاق: كل عضو يرى طلابه فقط', () => {
  const visible = async (uid: string, table: string, col = 'student_id') =>
    (await h.as(uid, (c) => c.query(`select ${col} as s from ${table} where ${col} = any($1)`, [[S.s1, S.s2, S.s3]]))).rows
      .map((r) => r.s)
      .sort();

  it('دور جديد بلا تحديد: الشيخ ومسؤول الحضور «كل الطلاب»، والبقية «لا أحد»', async () => {
    await h.sup(async (c) => {
      const { rows } = await c.query(
        `insert into roles(profile_id,circle_id,role) values ($1,$2,'sheikh'),($1,$2,'contact_officer') returning role, scope_all`,
        [U.outsider, C.A],
      );
      expect(Object.fromEntries(rows.map((r) => [r.role, r.scope_all]))).toEqual({ sheikh: true, contact_officer: false });
    });
  });

  it('الشيخ المقيّد بمجموعة يرى طلابها فقط، والشيخ العام يرى الجميع', async () => {
    expect(await visible(U.sheikhScoped, 'enrollments')).toEqual([S.s1, S.s2].sort());
    expect(await visible(U.sheikhAll, 'enrollments')).toEqual([S.s1, S.s2, S.s3].sort());
    expect(await visible(U.sheikhScoped, 'profiles', 'id')).toEqual([S.s1, S.s2].sort());
    expect(await visible(U.sheikhScoped, 'sheikh_notes')).toEqual([S.s1]);
    expect(await visible(U.sheikhAll, 'sheikh_notes')).toEqual([S.s1, S.s3].sort());
  });

  it('مسؤول الحضور المقيّد يسجّل لطلاب مجموعته فقط', async () => {
    await h.mustAffect(U.att, "insert into attendance(session_id,student_id,state) values ($1,$2,'present')", [SES.A, S.s1]);
    await h.mustFail(U.att, "insert into attendance(session_id,student_id,state) values ($1,$2,'present')", [SES.A, S.s3], /row-level/);
  });

  it('النطاق بالمجموعة يتبع أعضاءها: إضافة طالب للمجموعة تُدخله النطاق فورًا', async () => {
    await h.as(U.admin, async (c) => {
      ok(await attempt(c, 'insert into student_group_members(group_id,student_id) values ($1,$2)', [G.G1, S.s3]));
      await h.become(c, U.sheikhScoped);
      const { rows } = await c.query('select count(*)::int n from enrollments where student_id=$1', [S.s3]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('مسؤول الرسوم المقيّد بطالب لا يرى رسوم غيره ولا يحصّل منه', async () => {
    expect(await visible(U.fin, 'enrollments')).toEqual([S.s1]);
  });

  it('المدير يُسند مجموعة من مجلسه، ولا يُسند مجموعة مجلس آخر، والشيخ لا يُسند', async () => {
    await h.mustAffect(U.admin, 'insert into assignments(role_id,group_id) values ($1,$2)', [R.fin, G.G1]);
    await h.mustFail(U.admin, 'insert into assignments(role_id,group_id) values ($1,$2)', [R.fin, G.GB], /row-level/);
    await h.mustFail(U.sheikhAll, 'insert into assignments(role_id,group_id) values ($1,$2)', [R.fin, G.G1], /row-level/);
    await h.mustFail(U.admin, 'insert into assignments(role_id,student_id,group_id) values ($1,$2,$3)', [R.fin, S.s2, G.G1]);
  });

  it('المجموعات: المدير فقط ينشئها، ولا يضم إليها إلا طالبًا من مجلسه', async () => {
    await h.mustFail(U.sheikhAll, "insert into student_groups(circle_id,name) values ($1,'جديدة')", [C.A], /row-level/);
    await h.mustAffect(U.admin, "insert into student_groups(circle_id,name) values ($1,'جديدة')", [C.A]);
    await h.mustFail(U.admin, 'insert into student_group_members(group_id,student_id) values ($1,$2)', [G.G1, S.sB], /row-level/);
    await h.mustFail(U.admin, "insert into student_groups(circle_id,name) values ($1,'x')", [C.B], /row-level/);
  });

  it('حجم النطاق في أداء الفريق يعدّ أعضاء المجموعة المسندة', async () => {
    const { rows } = await h.as(U.admin, (c) =>
      c.query("select scope_size from v_officer_performance where profile_id=$1 and role='attendance_officer'", [U.att]),
    );
    expect(Number(rows[0].scope_size)).toBe(2);
  });
});

// =================================================================
suite('تعطيل الأعضاء', () => {
  it('المعطَّل يفقد كل صلاحياته فورًا ويعود عند إعادة التفعيل', async () => {
    await h.as(U.admin, async (c) => {
      ok(await attempt(c, 'select set_member_disabled($1, true)', [U.att]));
      await h.become(c, U.att);
      const sel = await c.query('select count(*)::int n from enrollments');
      expect(sel.rows[0].n).toBe(0);
      const ins = await attempt(c, "insert into attendance(session_id,student_id,state) values ($1,$2,'late')", [SES.A, S.s2]);
      expect(ins.ok).toBe(false);
      await h.become(c, U.admin);
      ok(await attempt(c, 'select set_member_disabled($1, false)', [U.att]));
      await h.become(c, U.att);
      const back = await c.query('select count(*)::int n from enrollments');
      expect(back.rows[0].n).toBe(2);
    });
  });

  it('لا يعطّل المدير نفسه، ولا من له صلاحيات في مجلس لا يديره، ولا يعطّل غير المدير أحدًا', async () => {
    await h.mustFail(U.admin, 'select set_member_disabled($1, true)', [U.admin], /صلاحية/);
    await h.mustFail(U.admin, 'select set_member_disabled($1, true)', [U.adminB], /صلاحية/);
    await h.mustFail(U.sheikhAll, 'select set_member_disabled($1, true)', [U.att], /صلاحية/);
    await h.as(U.admin, async (c) => {
      const r = ok(await attempt(c, 'select member_manageable($1) a, member_manageable($2) b, member_manageable($3) c', [U.att, U.adminB, U.admin]));
      expect(r[0]).toEqual({ a: true, b: false, c: false });
    });
  });

  it('شخص له دور في مجلس آخر لا يُدار من مدير هذا المجلس (يمنع الاستيلاء على حسابه)', async () => {
    await h.sup(async (c) => {
      await c.query("insert into roles(profile_id,circle_id,role) values ($1,$2,'contact_officer')", [U.att, C.B]);
      await h.become(c, U.admin);
      const r = ok(await attempt(c, 'select member_manageable($1) m', [U.att]));
      expect(r[0].m).toBe(false);
    });
  });
});

// =================================================================
suite('مستويات الأوراد', () => {
  /** يبني عبادتين ومستويين داخل المعاملة ويرجع معرّفاتها */
  async function buildLevels(c: Client) {
    await h.become(c, U.admin);
    const [prayer] = ok(await attempt(c, "insert into worship_items(circle_id,name,kind) values ($1,'الصلوات الخمس','check') returning id", [C.A]));
    const [quran] = ok(await attempt(c, "insert into worship_items(circle_id,name,kind,unit) values ($1,'القرآن','count','صفحة') returning id", [C.A]));
    const [l1] = ok(await attempt(c, "insert into wird_levels(circle_id,name,sort) values ($1,'المستوى الأول',1) returning id", [C.A]));
    const [l2] = ok(await attempt(c, "insert into wird_levels(circle_id,name,sort) values ($1,'المستوى الثاني',2) returning id", [C.A]));
    ok(await attempt(c, 'insert into wird_level_items(level_id,item_id) values ($1,$2)', [l1.id, prayer.id]));
    ok(await attempt(c, 'insert into wird_level_items(level_id,item_id) values ($1,$2),($1,$3)', [l2.id, prayer.id, quran.id]));
    ok(await attempt(c, 'update wird_level_items set target=5 where level_id=$1 and item_id=$2', [l2.id, quran.id]));
    return { prayer: String(prayer.id), quran: String(quran.id), l1: String(l1.id), l2: String(l2.id) };
  }

  it('العبادة لا تُضاف لمستوى مجلس آخر، وغير المدير/الشيخ لا يدير المستويات', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      await h.become(c, U.adminB);
      const [bLevel] = ok(await attempt(c, "insert into wird_levels(circle_id,name) values ($1,'ب') returning id", [C.B]));
      await h.become(c, U.admin);
      const cross = await attempt(c, 'insert into wird_level_items(level_id,item_id) values ($1,$2)', [bLevel.id, L.prayer]);
      expect(cross.ok).toBe(false);
      await h.become(c, U.att);
      expect((await attempt(c, "insert into wird_levels(circle_id,name) values ($1,'x')", [C.A])).ok).toBe(false);
    });
  });

  it('الإسناد لعدة طلاب، وتكراره لا يغيّر شيئًا، والنقل يحفظ السابق', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      expect(ok(await attempt(c, 'select assign_level($1,$2) n', [L.l1, [S.s1, S.s2]]))[0].n).toBe(2);
      expect(ok(await attempt(c, 'select assign_level($1,$2) n', [L.l1, [S.s1, S.s2]]))[0].n).toBe(0);
      expect(ok(await attempt(c, 'select assign_level($1,$2) n', [L.l2, [S.s1]]))[0].n).toBe(1);
      const hist = await c.query('select level_id, ended_at is null as active from student_levels where student_id=$1 order by started_at, active', [S.s1]);
      expect(hist.rows.map((r) => [r.level_id, r.active])).toEqual([[L.l1, false], [L.l2, true]]);
    });
  });

  it('الشيخ المقيّد لا يعيّن مستوى لطالب خارج نطاقه، ومسؤول الأوراد العام يعيّن', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      await h.become(c, U.sheikhScoped);
      expect((await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.s3]])).ok).toBe(false);
      expect((await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.s1]])).ok).toBe(true);
      await h.become(c, U.tasks);
      expect((await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.s3]])).ok).toBe(true);
      await h.become(c, U.att);
      expect((await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.s1]])).ok).toBe(false);
      // طالب من مجلس آخر
      await h.become(c, U.admin);
      expect((await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.sB]])).ok).toBe(false);
    });
  });

  it('مستوى الطالب لا يُكتب مباشرة (فقط عبر الإسناد الذي يحفظ السجل)', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      const r = await attempt(c, 'insert into student_levels(circle_id,student_id,level_id) values ($1,$2,$3)', [C.A, S.s1, L.l1]);
      expect(!r.ok && r.error.message).toMatch(/permission denied/);
    });
  });

  it('الطالب يسجّل أوراد مستواه فقط، وبالقيمة المناسبة لنوعها، ولا ليوم قادم', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      ok(await attempt(c, 'select assign_level($1,$2)', [L.l1, [U.student]]));
      await h.become(c, U.student);
      const ins = 'insert into wird_logs(student_id,item_id,day,done,value) values ($1,$2,$3,$4,$5)';
      expect((await attempt(c, ins, [U.student, L.prayer, 'today', true, null])).ok).toBe(true);
      const notInLevel = await attempt(c, ins, [U.student, L.quran, 'today', null, 3]);
      expect(!notInLevel.ok && notInLevel.error.message).toMatch(/ليست من أوراد مستوى/);
      const future = await attempt(c, ins, [U.student, L.prayer, '2999-01-01', true, null]);
      expect(!future.ok && future.error.message).toMatch(/لم يأتِ/);
      const noDone = await attempt(c, `update wird_logs set done=null where student_id=$1`, [U.student]);
      expect(!noDone.ok && noDone.error.message).toMatch(/تم أم لم يتم/);
      // لا يسجّل لغيره
      const other = await attempt(c, ins, [S.s1, L.prayer, 'today', true, null]);
      expect(other.ok).toBe(false);
      // يرى سجله فقط
      const mine = await c.query('select count(*)::int n from wird_logs');
      expect(mine.rows[0].n).toBe(1);
    });
  });

  it('تقرير الالتزام يُحسب على مستوى الطالب في كل يوم، والسجل القديم يبقى على مستواه القديم', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      await h.become(c, null);
      await c.query('reset role');
      // s1: المستوى الأول من قبل ٣ أيام حتى أمس، ثم الثاني من أمس
      await c.query(
        `insert into student_levels(circle_id,student_id,level_id,started_at,ended_at) values
           ($1,$2,$3, now() - interval '3 days', now() - interval '1 day'),
           ($1,$2,$4, now() - interval '1 day', null)`,
        [C.A, S.s1, L.l1, L.l2],
      );
      const ins = `insert into wird_logs(student_id,item_id,day,done,value) values ($1,$2,current_date - $3::int,$4,$5)`;
      await c.query(ins, [S.s1, L.prayer, 3, true, null]); // منجز (مستوى ١)
      await c.query(ins, [S.s1, L.prayer, 2, false, null]); // غير منجز (مستوى ١)
      await c.query(ins, [S.s1, L.prayer, 1, true, null]); // منجز (مستوى ٢)
      await c.query(ins, [S.s1, L.quran, 1, null, 6]); // ٦ ≥ ٥ منجز
      await c.query(ins, [S.s1, L.quran, 0, null, 3]); // ٣ < ٥ غير منجز
      const old = await c.query('select level_id from wird_logs where student_id=$1 and day=current_date-3', [S.s1]);
      expect(old.rows[0].level_id).toBe(L.l1);

      await h.become(c, U.admin);
      const { rows } = await c.query('select * from wird_report($1, current_date - 3, current_date) where student_id=$2', [C.A, S.s1]);
      // المطلوب: يومان × عبادة (مستوى ١) + يومان × عبادتان (مستوى ٢) = ٦، المنجز ٣
      expect(Number(rows[0].required)).toBe(6);
      expect(Number(rows[0].completed)).toBe(3);
      expect(rows[0].percent).toBe(50);
      expect(rows[0].level_name).toBe('المستوى الثاني');

      // الشيخ المقيّد يرى طلاب مجموعته فقط في التقرير
      await h.become(c, U.sheikhScoped);
      const scoped = await c.query('select student_id from wird_report($1, current_date - 3, current_date)', [C.A]);
      expect(scoped.rows.map((r) => r.student_id).sort()).toEqual([S.s1, S.s2].sort());
    });
  });

  it('دوال المساعدة لا تكشف مستوى طالب أو مدفوعاته لمن لا يراه', async () => {
    await h.as(U.admin, async (c) => {
      const L = await buildLevels(c);
      ok(await attempt(c, 'select assign_level($1,$2)', [L.l1, [S.s3]]));
      const [d] = ok(await attempt(c, "insert into fee_dues(enrollment_id,label,amount) values ($1,'ر',100) returning id", [E.s3]));
      ok(await attempt(c, 'insert into payments(enrollment_id,due_id,amount) values ($1,$2,40)', [E.s3, d.id]));
      expect(ok(await attempt(c, 'select level_on_day($1,$2,current_date) l, due_paid($3) p', [C.A, S.s3, d.id]))[0]).toEqual({ l: L.l1, p: '40.00' });
      await h.become(c, U.outsider);
      expect(ok(await attempt(c, 'select level_on_day($1,$2,current_date) l, due_paid($3) p', [C.A, S.s3, d.id]))[0]).toEqual({ l: null, p: '0' });
      await h.become(c, U.sheikhScoped); // s3 خارج مجموعته
      expect(ok(await attempt(c, 'select level_on_day($1,$2,current_date) l', [C.A, S.s3]))[0].l).toBeNull();
    });
  });

  it('فترة التقرير مقيّدة (لا عكسية ولا أطول من سنة)', async () => {
    await h.mustFail(U.admin, "select * from wird_report($1, current_date, current_date - 1)", [C.A], /قبل بدايتها/);
    await h.mustFail(U.admin, "select * from wird_report($1, current_date - 400, current_date)", [C.A], /سنة/);
  });
});

// =================================================================
suite('الحضور بالوقت والتعديل', () => {
  it('يُختم المسجِّل، والتعديل يُختم باسم من أجراه ووقته، والوقت بالدقيقة', async () => {
    await h.as(U.att, async (c) => {
      ok(await attempt(c, "insert into attendance(session_id,student_id,state,arrived_at,marked_by) values ($1,$2,'late', now() - interval '20 minutes 37 seconds', $3)", [SES.A, S.s1, U.admin]));
      const first = (await c.query('select marked_by, updated_by, extract(second from arrived_at)::int sec from attendance where session_id=$1 and student_id=$2', [SES.A, S.s1])).rows[0];
      expect(first).toMatchObject({ marked_by: U.att, updated_by: null, sec: 0 });

      await h.become(c, U.admin);
      ok(await attempt(c, "update attendance set state='present' where session_id=$1 and student_id=$2", [SES.A, S.s1]));
      const after = (await c.query('select marked_by, updated_by, updated_at is not null upd from attendance where session_id=$1 and student_id=$2', [SES.A, S.s1])).rows[0];
      expect(after).toEqual({ marked_by: U.att, updated_by: U.admin, upd: true });
    });
  });

  it('الغياب يمسح وقت الوصول، والوقت البعيد عن الجلسة مرفوض', async () => {
    await h.as(U.admin, async (c) => {
      ok(await attempt(c, "insert into attendance(session_id,student_id,state,arrived_at) values ($1,$2,'absent', now())", [SES.A, S.s2]));
      const r = (await c.query('select arrived_at from attendance where session_id=$1 and student_id=$2', [SES.A, S.s2])).rows[0];
      expect(r.arrived_at).toBeNull();
      const far = await attempt(c, "insert into attendance(session_id,student_id,state,arrived_at) values ($1,$2,'present', now() - interval '3 days')", [SES.A, S.s3]);
      expect(!far.ok && far.error.message).toMatch(/بعيد/);
    });
  });

  it('المزامنة بلا اتصال (upsert) تحدّث الحالة وتختم المعدِّل دون مسّ المسجِّل الأول', async () => {
    await h.as(U.att, async (c) => {
      const up = `insert into attendance(session_id,student_id,state,marked_at) values ($1,$2,$3, now())
                  on conflict (session_id,student_id) do update set state = excluded.state, marked_at = excluded.marked_at`;
      ok(await attempt(c, up, [SES.A, S.s2, 'present']));
      ok(await attempt(c, up, [SES.A, S.s2, 'late']));
      const r = (await c.query('select state, marked_by, updated_by from attendance where session_id=$1 and student_id=$2', [SES.A, S.s2])).rows[0];
      expect(r).toEqual({ state: 'late', marked_by: U.att, updated_by: U.att });
    });
  });

  it('تقرير الحضور لكل طالب، ومتوسط دقائق التأخير، وتصفية بالمجموعة', async () => {
    await h.as(U.admin, async (c) => {
      // جلسة ثانية قبل يومين
      const [s2] = ok(await attempt(c, "insert into sessions(circle_id,held_at) values ($1, now() - interval '2 days') returning id, held_at", [C.A]));
      await c.query("insert into attendance(session_id,student_id,state,arrived_at) select $1,$2,'late', held_at + interval '15 minutes' from sessions where id=$1", [SES.A, S.s1]);
      await c.query("insert into attendance(session_id,student_id,state,arrived_at) select $1,$2,'present', held_at from sessions where id=$1", [s2.id, S.s1]);
      await c.query("insert into attendance(session_id,student_id,state) values ($1,$2,'absent')", [SES.A, S.s2]);

      const all = await c.query('select * from attendance_report($1, current_date - 7, current_date)', [C.A]);
      const s1 = all.rows.find((r) => r.student_id === S.s1)!;
      expect(s1).toMatchObject({ late: '1', present: '1', unmarked: '0', rate: 100, avg_late_minutes: 15 });
      expect(Number(s1.sessions)).toBe(2);
      const s3 = all.rows.find((r) => r.student_id === S.s3)!;
      expect(Number(s3.unmarked)).toBe(2);

      const grp = await c.query('select student_id from attendance_report($1, current_date - 7, current_date, $2)', [C.A, G.G1]);
      expect(grp.rows.map((r) => r.student_id).sort()).toEqual([S.s1, S.s2].sort());
    });
  });
});

// =================================================================
suite('الرسوم المستحقة والدفعات', () => {
  const newDue = async (c: Client, enrollment: string, amount = 300, extra = '') =>
    String(ok(await attempt(c, `insert into fee_dues(enrollment_id,label,amount${extra ? ',' + extra.split('=')[0] : ''}) values ($1,'رسوم',$2${extra ? ",'" + extra.split('=')[1] + "'" : ''}) returning id`, [enrollment, amount]))[0].id);
  const pay = (c: Client, enrollment: string, due: string, amount: number, ref: string | null = null) =>
    attempt(c, 'insert into payments(enrollment_id,due_id,amount,client_ref) values ($1,$2,$3,$4)', [enrollment, due, amount, ref]);
  const status = async (c: Client, due: string) =>
    (await c.query('select status, paid, remaining from v_fee_dues where id=$1', [due])).rows[0];

  it('دفع جزئي بدفعات متعددة، والمتبقي يُحسب، والتجاوز مرفوض برسالة واضحة', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s1);
      expect((await status(c, d)).status).toBe('unpaid');
      ok(await pay(c, E.s1, d, 100));
      ok(await pay(c, E.s1, d, 150));
      expect(await status(c, d)).toMatchObject({ status: 'partial', paid: '250.00', remaining: '50.00' });
      const over = await pay(c, E.s1, d, 60);
      expect(!over.ok && over.error.message).toMatch(/أكبر من المتبقي \(50/);
      ok(await pay(c, E.s1, d, 50));
      expect((await status(c, d)).status).toBe('paid');
    });
  });

  it('نفس الدفعة لا تُحسب مرتين (client_ref)', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s2);
      const ref = id(990);
      ok(await pay(c, E.s2, d, 100, ref));
      const again = await pay(c, E.s2, d, 100, ref);
      expect(!again.ok && again.error.code).toBe('23505');
      expect((await status(c, d)).paid).toBe('100.00');
    });
  });

  it('الدفعة بلا رسوم مستحقة، أو على رسوم طالب آخر، مرفوضة', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s1);
      const noDue = await attempt(c, 'insert into payments(enrollment_id,amount) values ($1,10)', [E.s1]);
      expect(!noDue.ok && noDue.error.message).toMatch(/اختر الرسوم/);
      const wrong = await pay(c, E.s2, d, 10);
      expect(!wrong.ok && wrong.error.message).toMatch(/لا تخص/);
    });
  });

  it('الإعفاء الكلي يجعلها «معفى» ويمنع الدفع، والجزئي يُنقص المتبقي', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s3);
      ok(await attempt(c, "update fee_dues set exempt_amount=300, exempt_reason='يتيم' where id=$1", [d]));
      expect((await status(c, d)).status).toBe('exempt');
      expect((await pay(c, E.s3, d, 1)).ok).toBe(false);
      ok(await attempt(c, "update fee_dues set exempt_amount=100, exempt_reason='ظرف' where id=$1", [d]));
      expect(await status(c, d)).toMatchObject({ status: 'unpaid', remaining: '200.00' });
    });
  });

  it('القيد العكسي يتبع رسوم الإيصال الأصلي فيعيد المتبقي', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s1);
      const [p] = ok(await attempt(c, 'insert into payments(enrollment_id,due_id,amount) values ($1,$2,300) returning id', [E.s1, d]));
      ok(await attempt(c, "insert into payments(enrollment_id,amount,reversal_of,note) values ($1,-300,$2,'خطأ')", [E.s1, p.id]));
      expect(await status(c, d)).toMatchObject({ status: 'unpaid', paid: '0.00', remaining: '300.00' });
    });
  });

  it('لا تُحذف رسوم عليها دفعات، ولا يُنزَل مبلغها تحت المدفوع، ولا تُنقل لطالب آخر', async () => {
    await h.as(U.admin, async (c) => {
      const d = await newDue(c, E.s1);
      ok(await pay(c, E.s1, d, 200));
      const del = await attempt(c, 'delete from fee_dues where id=$1', [d]);
      expect(!del.ok && del.error.message).toMatch(/لا تُحذف/);
      const lower = await attempt(c, 'update fee_dues set amount=150 where id=$1', [d]);
      expect(!lower.ok && lower.error.message).toMatch(/المدفوع/);
      const move = await attempt(c, 'update fee_dues set enrollment_id=$2 where id=$1', [d, E.s2]);
      expect(!move.ok && move.error.message).toMatch(/لا يُنقل/);
      const free = await newDue(c, E.s2);
      expect((await attempt(c, 'delete from fee_dues where id=$1', [free])).ok).toBe(true);
    });
  });

  it('مسؤول الرسوم يدير رسوم نطاقه فقط، والطالب يرى رسومه فقط، ومسؤول الحضور لا يرى شيئًا', async () => {
    await h.as(U.fin, async (c) => {
      expect((await attempt(c, "insert into fee_dues(enrollment_id,label,amount) values ($1,'ر',100)", [E.s1])).ok).toBe(true);
      expect((await attempt(c, "insert into fee_dues(enrollment_id,label,amount) values ($1,'ر',100)", [E.s2])).ok).toBe(false);
    });
    await h.as(U.admin, async (c) => {
      await newDue(c, E.student, 100);
      await newDue(c, E.s2, 100);
      await h.become(c, U.student);
      const mine = await c.query('select count(*)::int n from v_fee_dues');
      expect(mine.rows[0].n).toBe(1);
      await h.become(c, U.att);
      expect((await c.query('select count(*)::int n from v_fee_dues')).rows[0].n).toBe(0);
    });
  });

  it('إنشاء رسوم خطة لكل الطلاب دفعة واحدة، والتكرار لنفس الفترة يُتجاهل', async () => {
    await h.as(U.admin, async (c) => {
      const first = ok(await attempt(c, "select create_plan_dues($1,'2026-09-01','2026-12-31') n", [FP.A]))[0].n;
      expect(first).toBe(4); // s1 s2 s3 student
      expect(ok(await attempt(c, "select create_plan_dues($1,'2026-09-01','2026-12-31') n", [FP.A]))[0].n).toBe(0);
      expect(ok(await attempt(c, "select create_plan_dues($1,'2027-01-01','2027-04-30',$2) n", [FP.A, [S.s1]]))[0].n).toBe(1);
      await h.become(c, U.fin);
      // مسؤول الرسوم المقيّد بطالب واحد ينشئ لنطاقه فقط
      expect(ok(await attempt(c, "select create_plan_dues($1,'2027-05-01',null) n", [FP.A]))[0].n).toBe(1);
      await h.become(c, U.att);
      expect((await attempt(c, "select create_plan_dues($1,'2027-06-01',null)", [FP.A])).ok).toBe(false);
    });
  });

  it('رصيد الطالب وحالته يجمعان كل رسومه', async () => {
    await h.as(U.admin, async (c) => {
      const a = await newDue(c, E.s3, 200);
      await newDue(c, E.s3, 100);
      ok(await pay(c, E.s3, a, 200));
      const r = (await c.query('select due, paid, remaining, status, dues_count from v_enrollment_balance where enrollment_id=$1', [E.s3])).rows[0];
      expect(r).toMatchObject({ due: '300.00', paid: '200.00', remaining: '100.00', status: 'partial', dues_count: '2' });
    });
  });
});

// =================================================================
suite('نقل البيانات القديمة بلا فقد', () => {
  const legacy = new Harness();

  it('الخطة والإعفاء والدفعة القديمة تتحول إلى رسوم مستحقة مربوطة', async () => {
    const full = setupSql();
    const marker = '-- >>>>>>>>>>>>>>>>>>>> migrations/0010';
    const cut = full.indexOf(marker);
    expect(cut).toBeGreaterThan(0);
    const before = `${full.slice(0, cut)}\ncommit;\n`;
    const after = `begin;\n${full.slice(cut)}`;

    await legacy.open('majales_legacy', before);
    try {
      const q = (sql: string, p: unknown[] = []) => legacy.db.query(sql, p);
      await q("insert into circles(id,name) values ($1,'قديم')", [C.A]);
      await q("insert into profiles(id,full_name) values ($1,'أ'),($2,'ب'),($3,'ج')", [S.s1, S.s2, S.s3]);
      await q("insert into fee_plans(id,circle_id,name,total_amount) values ($1,$2,'قديمة',300)", [FP.A, C.A]);
      await q(
        "insert into enrollments(id,circle_id,student_id,fee_plan_id,exempt_reason) values ($1,$4,$2,$5,null),($3,$4,$6,$5,'يتيم'),($7,$4,$8,null,null)",
        [E.s1, S.s1, E.s2, C.A, FP.A, S.s2, E.s3, S.s3],
      );
      // دفعة بالنظام القديم (بلا due_id)
      await q('insert into payments(enrollment_id,amount) values ($1,120)', [E.s1]);

      await q(after);

      const dues = await q('select enrollment_id, amount, exempt_amount, exempt_reason from fee_dues order by enrollment_id');
      expect(dues.rows).toEqual([
        { enrollment_id: E.s1, amount: '300.00', exempt_amount: '0.00', exempt_reason: null },
        { enrollment_id: E.s2, amount: '300.00', exempt_amount: '300.00', exempt_reason: 'يتيم' },
      ]);
      const linked = await q('select count(*)::int n from payments where due_id is not null');
      expect(linked.rows[0].n).toBe(1);
      // حالة كل استحقاق (v_fee_dues بلا تصفية مستخدم، فيُقرأ هنا كله)
      const st = await q('select enrollment_id, status, remaining from v_fee_dues order by enrollment_id');
      expect(st.rows.map((r) => [r.enrollment_id, r.status, r.remaining])).toEqual([
        [E.s1, 'partial', '180.00'],
        [E.s2, 'exempt', '0.00'],
      ]);
      // الإيصال القديم نفسه لم يتغير مبلغه
      expect((await q('select amount from payments')).rows[0].amount).toBe('120.00');
    } finally {
      await legacy.close();
    }
  });
});
