// @vitest-environment node
/**
 * اختبارات قاعدة البيانات والصلاحيات (RLS) على Postgres حقيقي.
 * التشغيل:  TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
 * يُنشئ قاعدة مؤقتة، ويطبّق supabase/setup_all.sql على مشروع «مقفول» يحاكي Supabase الجديد،
 * ثم يجرّب كل دور بصفته. كل اختبار داخل معاملة تُلغى، فلا يتأثر غيره.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const suite = ADMIN_URL ? describe : describe.skip;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---- هويات الاختبار ----
const U = {
  adminA: id(1), adminB: id(2), sheikhA: id(3), contactA: id(4), attA: id(5),
  finA: id(6), tasksA: id(7), transA: id(8), studentA: id(9), outsider: id(10), newcomer: id(11),
};
const CIRCLE = { A: id(100), B: id(101) };
const S = { sA1: id(201), sA2: id(202), sB1: id(203) }; // طلاب بلا حساب دخول
const FP = { A: id(300), B: id(301) };
const E = { A1: id(400), A2: id(401), studentA: id(402), B1: id(403) };
const R = { adminA: id(500), adminB: id(501), sheikhA: id(502), contactA: id(503), attA: id(504), finA: id(505), tasksA: id(506), transA: id(507) };
const SESS = { A: id(600), B: id(601) };
const TASK = { A: id(700), B: id(701) };
const PAY = { A: id(800), B: id(801) };
const NOTE = { A: id(900), B: id(901) };
const CONTACT = { A1: id(950), A2: id(951), B: id(952) };

const A = { circle: CIRCLE.A, session: SESS.A, task: TASK.A, student: S.sA1, enrollment: E.A1, payment: PAY.A, note: NOTE.A, contact: CONTACT.A1, plan: FP.A };
const B = { circle: CIRCLE.B, session: SESS.B, task: TASK.B, student: S.sB1, enrollment: E.B1, payment: PAY.B, note: NOTE.B, contact: CONTACT.B, plan: FP.B };

/** يقرأ ملف التهيئة في كل مرة؛ SETUP_SQL يسمح باختبار «الطفرات» (ملف مُفسَد عمدًا يجب أن تفشل عليه الاختبارات). */
const setupSql = () =>
  readFileSync(process.env.SETUP_SQL ?? fileURLToPath(new URL('../../supabase/setup_all.sql', import.meta.url)), 'utf8');

let db: Client;
let adminClient: Client;
let dbName: string;

type Err = { code?: string; message: string };
type Attempt = { ok: true; rows: Record<string, unknown>[]; rowCount: number } | { ok: false; error: Err };

async function run<T>(role: 'authenticated' | 'anon' | 'super', uid: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    if (role !== 'super') await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    return await fn(db);
  } finally {
    await db.query('rollback');
  }
}
const as = <T>(uid: string | null, fn: (c: Client) => Promise<T>) => run('authenticated', uid, fn);
const sup = <T>(fn: (c: Client) => Promise<T>) => run('super', null, fn);

/** ينفّذ داخل savepoint فلا يُفسد خطأ واحد بقية المعاملة. */
async function attempt(c: Client, sql: string, params: unknown[] = []): Promise<Attempt> {
  await c.query('savepoint sp');
  try {
    const r = await c.query(sql, params);
    await c.query('release savepoint sp');
    return { ok: true, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await c.query('rollback to savepoint sp');
    return { ok: false, error: e as Err };
  }
}

/** معرّف أول صف من محاولة ناجحة (يفشل الاختبار بوضوح إن كانت المحاولة رُفضت). */
const firstId = (r: Attempt): string => {
  if (!r.ok) throw new Error(`رُفضت المحاولة: ${r.error.message}`);
  return String(r.rows[0].id);
};

const rows = (uid: string, sql: string, params: unknown[] = []) => as(uid, async (c) => (await c.query(sql, params)).rows);
const count = async (uid: string, sql: string, params: unknown[] = []) => Number((await rows(uid, sql, params))[0].n);
const tryAs = (uid: string, sql: string, params: unknown[] = []) => as(uid, (c) => attempt(c, sql, params));
const mustFail = async (uid: string, sql: string, params: unknown[] = [], pattern?: RegExp) => {
  const r = await tryAs(uid, sql, params);
  expect(r.ok, `كان يجب أن يُرفض: ${sql}`).toBe(false);
  if (!r.ok && pattern) expect(r.error.message).toMatch(pattern);
};
/** تحديث/حذف مسموح شكليًا لكنه لا يطال أي صف بفعل RLS. */
const mustAffectNothing = async (uid: string, sql: string, params: unknown[] = []) => {
  const r = await tryAs(uid, sql, params);
  expect(r.ok && r.rowCount, `كان يجب ألا يطال صفًا: ${sql}`).toBe(0);
};
const mustAffect = async (uid: string, sql: string, params: unknown[] = [], n = 1) => {
  const r = await tryAs(uid, sql, params);
  expect(r.ok, `كان يجب أن ينجح: ${sql}${r.ok ? '' : ' → ' + r.error.message}`).toBe(true);
  if (r.ok) expect(r.rowCount).toBe(n);
};

beforeAll(async () => {
  if (!ADMIN_URL) return;
  dbName = `majales_test_${process.pid}_${Date.now()}`;
  adminClient = new Client({ connectionString: ADMIN_URL });
  await adminClient.connect();
  await adminClient.query(`create database ${dbName}`);

  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  db = new Client({ connectionString: u.toString() });
  await db.connect();

  await db.query(readFileSync(fileURLToPath(new URL('./stub.sql', import.meta.url)), 'utf8'));
  await db.query(setupSql());
  await seed();
});

afterAll(async () => {
  if (!ADMIN_URL) return;
  await db?.end();
  await adminClient.query(`drop database if exists ${dbName} with (force)`);
  await adminClient.end();
});

async function seed() {
  const q = (sql: string, p: unknown[] = []) => db.query(sql, p);
  for (const [name, uid] of Object.entries(U)) {
    await q('insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)', [
      uid, `${name}@test.local`, JSON.stringify({ full_name: name }),
    ]);
  }
  await q("insert into circles(id,name,type) values ($1,'مجلس أ','public'), ($2,'مجلس ب','private')", [CIRCLE.A, CIRCLE.B]);
  const roles: [string, string, string, string][] = [
    [R.adminA, U.adminA, CIRCLE.A, 'admin'], [R.adminB, U.adminB, CIRCLE.B, 'admin'],
    [R.sheikhA, U.sheikhA, CIRCLE.A, 'sheikh'], [R.contactA, U.contactA, CIRCLE.A, 'contact_officer'],
    [R.attA, U.attA, CIRCLE.A, 'attendance_officer'], [R.finA, U.finA, CIRCLE.A, 'finance_officer'],
    [R.tasksA, U.tasksA, CIRCLE.A, 'tasks_officer'], [R.transA, U.transA, CIRCLE.A, 'transcription_officer'],
  ];
  for (const [rid, pid, cid, role] of roles) {
    await q('insert into roles(id,profile_id,circle_id,role) values ($1,$2,$3,$4)', [rid, pid, cid, role]);
  }
  for (const [sid, name] of [[S.sA1, 'طالب أ١'], [S.sA2, 'طالب أ٢'], [S.sB1, 'طالب ب١']]) {
    await q('insert into profiles(id,full_name,phone) values ($1,$2,$3)', [sid, name, '01000000000']);
  }
  await q("insert into fee_plans(id,circle_id,name,total_amount) values ($1,$2,'خطة أ',300), ($3,$4,'خطة ب',500)", [FP.A, CIRCLE.A, FP.B, CIRCLE.B]);
  await q(
    `insert into enrollments(id,circle_id,student_id,fee_plan_id) values
       ($1,$2,$3,$4), ($5,$2,$6,$4), ($7,$2,$8,$4), ($9,$10,$11,$12)`,
    [E.A1, CIRCLE.A, S.sA1, FP.A, E.A2, S.sA2, E.studentA, U.studentA, E.B1, CIRCLE.B, S.sB1, FP.B],
  );
  for (const r of [R.contactA, R.finA, R.tasksA]) {
    await q('insert into assignments(role_id,student_id) values ($1,$2)', [r, S.sA1]);
  }
  await q("insert into sessions(id,circle_id,held_at) values ($1,$2,now()), ($3,$4,now())", [SESS.A, CIRCLE.A, SESS.B, CIRCLE.B]);
  await q(
    "insert into tasks(id,session_id,type,title) values ($1,$2,'worship','ورد أ'), ($3,$4,'worship','ورد ب')",
    [TASK.A, SESS.A, TASK.B, SESS.B],
  );
  await q("insert into attendance(session_id,student_id,state) values ($1,$2,'present'), ($3,$4,'absent')", [SESS.A, S.sA1, SESS.B, S.sB1]);
  await q(
    `insert into contacts_log(id,session_id,student_id,by_profile_id,outcome,note) values
       ($1,$2,$3,$4,'confirmed','ملاحظة خاصة'), ($5,$2,$6,$4,'no_answer',null), ($7,$8,$9,$10,'confirmed',null)`,
    [CONTACT.A1, SESS.A, S.sA1, U.contactA, CONTACT.A2, S.sA2, CONTACT.B, SESS.B, S.sB1, U.adminB],
  );
  await q('insert into payments(id,enrollment_id,amount) values ($1,$2,100), ($3,$4,50)', [PAY.A, E.A1, PAY.B, E.B1]);
  await q("insert into summaries(session_id,summary_md,status,by_profile_id) values ($1,'مسودة','draft',$2)", [SESS.A, U.transA]);
  await q("insert into summaries(session_id,summary_md,status,published_at) values ($1,'منشور','published',now())", [SESS.B]);
  await q("insert into sheikh_notes(id,student_id,body) values ($1,$2,'سري أ'), ($3,$4,'سري ب')", [NOTE.A, S.sA1, NOTE.B, S.sB1]);
  await q(
    "insert into task_progress(task_id,student_id,state) values ($1,$2,'done'), ($3,$4,'done')",
    [TASK.A, S.sA1, TASK.B, S.sB1],
  );
}

const TABLES = [
  'profiles', 'circles', 'fee_plans', 'enrollments', 'roles', 'assignments', 'sessions', 'contacts_log',
  'attendance', 'payments', 'tasks', 'task_progress', 'summaries', 'wa_templates', 'sheikh_notes', 'audit_log',
];
const VIEWS = [
  'v_session_contacts', 'v_session_attendance_summary', 'v_enrollment_balance', 'v_task_completion',
  'v_officer_performance', 'v_student_attendance_stats',
];

suite('الزائر غير المسجّل (anon)', () => {
  it.each([...TABLES, ...VIEWS])('لا يقرأ %s', async (t) => {
    await run('anon', null, async (c) => {
      const r = await attempt(c, `select * from ${t}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/permission denied/);
    });
  });

  it.each(TABLES)('لا يكتب في %s', async (t) => {
    await run('anon', null, async (c) => {
      const r = await attempt(c, `insert into ${t} default values`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/permission denied/);
    });
  });

  it('لا ينفّذ add_student', async () => {
    await run('anon', null, async (c) => {
      const r = await attempt(c, 'select add_student($1, $2)', [CIRCLE.A, 'مجهول']);
      expect(r.ok).toBe(false);
    });
  });
});

suite('العزل بين المجالس: لا يرى المدير ولا يلمس إلا مجلسه', () => {
  const readChecks = (o: typeof A) => [
    ['circles', `select count(*)::int n from circles where id='${o.circle}'`],
    ['enrollments', `select count(*)::int n from enrollments where circle_id='${o.circle}'`],
    ['roles', `select count(*)::int n from roles where circle_id='${o.circle}'`],
    ['fee_plans', `select count(*)::int n from fee_plans where circle_id='${o.circle}'`],
    ['sessions', `select count(*)::int n from sessions where id='${o.session}'`],
    ['attendance', `select count(*)::int n from attendance where session_id='${o.session}'`],
    ['contacts_log', `select count(*)::int n from contacts_log where session_id='${o.session}'`],
    ['payments', `select count(*)::int n from payments where id='${o.payment}'`],
    ['tasks', `select count(*)::int n from tasks where id='${o.task}'`],
    ['task_progress', `select count(*)::int n from task_progress where task_id='${o.task}'`],
    ['summaries', `select count(*)::int n from summaries where session_id='${o.session}'`],
    ['sheikh_notes', `select count(*)::int n from sheikh_notes where id='${o.note}'`],
    ['profiles', `select count(*)::int n from profiles where id='${o.student}'`],
    ['assignments', `select count(*)::int n from assignments where student_id='${o.student}'`],
    ['audit_log', `select count(*)::int n from audit_log where circle_id='${o.circle}'`],
    ['v_enrollment_balance', `select count(*)::int n from v_enrollment_balance where circle_id='${o.circle}'`],
    ['v_student_attendance_stats', `select count(*)::int n from v_student_attendance_stats where circle_id='${o.circle}'`],
    ['v_session_attendance_summary', `select count(*)::int n from v_session_attendance_summary where circle_id='${o.circle}'`],
    ['v_officer_performance', `select count(*)::int n from v_officer_performance where circle_id='${o.circle}'`],
  ] as const;

  it.each(readChecks(B))('مدير أ لا يرى %s الخاصة بمجلس ب', async (_n, sql) => {
    expect(await count(U.adminA, sql)).toBe(0);
  });

  // مجلس أ «عام» فيراه الجميع بالتصميم، فنستثني صف المجلس نفسه هنا
  it.each(readChecks(A).filter(([n]) => n !== 'circles'))('مدير ب لا يرى %s الخاصة بمجلس أ', async (_n, sql) => {
    expect(await count(U.adminB, sql)).toBe(0);
  });

  it.each(readChecks(A))('(ضابط) مدير أ يرى %s في مجلسه فعلًا', async (name, sql) => {
    // يضمن أن الاختبارات أعلاه ليست ناجحة لمجرد أن الجداول فارغة
    if (['audit_log'].includes(name)) return;
    expect(await count(U.adminA, sql)).toBeGreaterThan(0);
  });

  it('سجل التدقيق: كل مدير يرى سجل مجلسه ولا يرى الآخر', async () => {
    expect(await count(U.adminA, `select count(*)::int n from audit_log where circle_id='${CIRCLE.A}'`)).toBeGreaterThan(0);
    expect(await count(U.adminB, `select count(*)::int n from audit_log where circle_id='${CIRCLE.B}'`)).toBeGreaterThan(0);
    expect(await count(U.adminA, `select count(*)::int n from audit_log`)).toBe(
      await count(U.adminA, `select count(*)::int n from audit_log where circle_id='${CIRCLE.A}'`),
    );
  });

  it('مدير أ لا ينشئ جلسة ولا تكليفًا ولا دفعة ولا دورًا في مجلس ب', async () => {
    await mustFail(U.adminA, 'insert into sessions(circle_id,held_at) values ($1, now())', [CIRCLE.B]);
    await mustFail(U.adminA, "insert into tasks(session_id,type,title) values ($1,'worship','x')", [SESS.B]);
    await mustFail(U.adminA, 'insert into payments(enrollment_id,amount) values ($1, 10)', [E.B1]);
    await mustFail(U.adminA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'contact_officer')", [U.outsider, CIRCLE.B]);
    await mustFail(U.adminA, "insert into task_progress(task_id,student_id,state) values ($1,$2,'done')", [TASK.B, S.sB1].map(String), /row-level/);
    await mustFail(U.adminA, "insert into sheikh_notes(student_id,body) values ($1,'x')", [S.sB1]);
    await mustFail(U.adminA, "insert into fee_plans(circle_id,name,total_amount) values ($1,'x',1)", [CIRCLE.B]);
    await mustFail(U.adminA, 'select add_student($1, $2)', [CIRCLE.B, 'دخيل'], /صلاحية/);
  });

  it('مدير أ لا يعدّل ولا يحذف شيئًا من مجلس ب', async () => {
    await mustAffectNothing(U.adminA, "update enrollments set exempt_reason='x' where circle_id=$1", [CIRCLE.B]);
    await mustAffectNothing(U.adminA, 'delete from enrollments where circle_id=$1', [CIRCLE.B]);
    await mustAffectNothing(U.adminA, "update sessions set status='closed' where id=$1", [SESS.B]);
    await mustAffectNothing(U.adminA, 'delete from sessions where id=$1', [SESS.B]);
    await mustAffectNothing(U.adminA, "update summaries set summary_md='x' where session_id=$1", [SESS.B]);
    await mustAffectNothing(U.adminA, "update circles set name='x' where id=$1", [CIRCLE.B]);
    await mustAffectNothing(U.adminA, "update roles set revoked_at=now() where circle_id=$1", [CIRCLE.B]);
    await mustAffectNothing(U.adminA, "update profiles set full_name='x' where id=$1", [S.sB1]);
  });

  it('لا يُسنَد إلى مسؤول طالبٌ من مجلس آخر (تسريب النطاق)', async () => {
    await mustFail(U.adminA, 'insert into assignments(role_id,student_id) values ($1,$2)', [R.contactA, S.sB1], /row-level/);
    await mustAffect(U.adminA, 'insert into assignments(role_id,student_id) values ($1,$2)', [R.contactA, S.sA2]);
  });
});

suite('أقل صلاحية لكل دور', () => {
  it('الشيخ لا يسند أدوارًا ولا يرفع نفسه مديرًا ولا يسند نطاقًا', async () => {
    await mustFail(U.sheikhA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'admin')", [U.sheikhA, CIRCLE.A], /row-level/);
    await mustFail(U.sheikhA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'finance_officer')", [U.outsider, CIRCLE.A]);
    await mustAffectNothing(U.sheikhA, "update roles set role='admin' where id=$1", [R.sheikhA]);
    await mustAffectNothing(U.sheikhA, 'update roles set revoked_at=now() where id=$1', [R.contactA]);
    await mustFail(U.sheikhA, 'insert into assignments(role_id,student_id) values ($1,$2)', [R.contactA, S.sA2]);
    await mustAffectNothing(U.sheikhA, "update circles set name='x' where id=$1", [CIRCLE.A]);
  });

  it('الشيخ يقرأ ملاحظاته ويكتب ملاحظة لطالب مجلسه فقط', async () => {
    expect(await count(U.sheikhA, 'select count(*)::int n from sheikh_notes')).toBe(1);
    await mustAffect(U.sheikhA, "insert into sheikh_notes(student_id,body) values ($1,'ملاحظة')", [S.sA1]);
    await mustFail(U.sheikhA, "insert into sheikh_notes(student_id,body) values ($1,'x')", [S.sB1]);
  });

  it('المدير وحده يسند الأدوار ويسحبها داخل مجلسه', async () => {
    await mustAffect(U.adminA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'contact_officer')", [U.outsider, CIRCLE.A]);
    await mustAffect(U.adminA, 'update roles set revoked_at=now() where id=$1', [R.contactA]);
  });

  it('مسؤول التواصل: يرى طلاب نطاقه فقط، ولا يرى الرسوم ولا ملاحظات الشيخ', async () => {
    expect(await count(U.contactA, `select count(*)::int n from profiles where id='${S.sA1}'`)).toBe(1);
    expect(await count(U.contactA, `select count(*)::int n from profiles where id='${S.sA2}'`)).toBe(0);
    expect(await count(U.contactA, 'select count(*)::int n from sheikh_notes')).toBe(0);
    await mustFail(U.contactA, 'select * from payments', [], /./).catch(() => {});
    expect(await count(U.contactA, 'select count(*)::int n from payments')).toBe(0);
    expect(await count(U.contactA, 'select count(*)::int n from v_enrollment_balance')).toBe(0); // لا مستحق ولا خطة
    await mustAffectNothing(U.contactA, "update enrollments set fee_plan_id=null, exempt_reason='x'");
    await mustFail(U.contactA, 'insert into enrollments(circle_id,student_id) values ($1,$2)', [CIRCLE.A, U.outsider]);
    await mustFail(U.contactA, "insert into payments(enrollment_id,amount) values ($1,10)", [E.A1]);
    await mustFail(U.contactA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'admin')", [U.contactA, CIRCLE.A]);
  });

  it('مسؤول التواصل يعدّل بيانات طالب نطاقه لا غيره', async () => {
    await mustAffect(U.contactA, "update profiles set phone='01111111111' where id=$1", [S.sA1]);
    await mustAffectNothing(U.contactA, "update profiles set phone='01111111111' where id=$1", [S.sA2]);
  });

  it('مسؤول الرسوم: دفعات نطاقه فقط، ولا يحصّل خارجه', async () => {
    expect(await count(U.finA, 'select count(*)::int n from payments')).toBe(1);
    expect(await count(U.finA, 'select count(*)::int n from v_enrollment_balance')).toBe(1);
    await mustAffect(U.finA, "insert into payments(enrollment_id,amount) values ($1,25)", [E.A1]);
    await mustFail(U.finA, "insert into payments(enrollment_id,amount) values ($1,25)", [E.A2], /row-level/);
    expect(await count(U.finA, 'select count(*)::int n from sheikh_notes')).toBe(0);
    await mustFail(U.finA, "insert into attendance(session_id,student_id,state) values ($1,$2,'present')", [SESS.A, S.sA2]);
  });

  it('مسؤول الحضور: يسجّل الحضور ويرى المؤكَّدين فقط، ولا يرى الرسوم', async () => {
    await mustAffect(U.attA, "insert into attendance(session_id,student_id,state) values ($1,$2,'late')", [SESS.A, S.sA2]);
    expect(await count(U.attA, 'select count(*)::int n from payments')).toBe(0);
    const seen = await rows(U.attA, 'select outcome from contacts_log');
    expect(seen.length).toBe(1);
    expect(seen.every((r) => r.outcome === 'confirmed')).toBe(true);
    await mustAffectNothing(U.attA, 'delete from sessions');
    await mustAffect(U.attA, "update sessions set status='closed' where id=$1", [SESS.A]);
  });

  it('مزامنة الحضور (upsert) تحدّث السجل القائم بصلاحية مسؤول الحضور', async () => {
    const sql = `insert into attendance(session_id,student_id,state) values ($1,$2,$3)
                 on conflict (session_id,student_id) do update set state = excluded.state`;
    await as(U.attA, async (c) => {
      expect((await attempt(c, sql, [SESS.A, S.sA1, 'excused'])).ok).toBe(true);
      const { rows: r } = await c.query('select state from attendance where session_id=$1 and student_id=$2', [SESS.A, S.sA1]);
      expect(r[0].state).toBe('excused');
    });
  });

  it('مسؤول التكاليف: يضيف ويعدّل ولا يحذف', async () => {
    await mustAffect(U.tasksA, "insert into tasks(session_id,type,title) values ($1,'research','بحث جديد')", [SESS.A]);
    await mustAffect(U.tasksA, "update tasks set description='د' where id=$1", [TASK.A]);
    await mustAffectNothing(U.tasksA, 'delete from tasks');
  });

  it('الطالب: يرى انتسابه وحده، ولا يقرأ دفعات ولا ملاحظات الآخرين، ويكتب إنجازه فقط', async () => {
    expect(await count(U.studentA, 'select count(*)::int n from enrollments')).toBe(1);
    expect(await count(U.studentA, 'select count(*)::int n from payments')).toBe(0);
    expect(await count(U.studentA, 'select count(*)::int n from sheikh_notes')).toBe(0);
    expect(await count(U.studentA, 'select count(*)::int n from contacts_log')).toBe(0);
    expect(await count(U.studentA, `select count(*)::int n from profiles where id <> '${U.studentA}'`)).toBe(0);
    await mustAffect(U.studentA, "insert into task_progress(task_id,student_id,state) values ($1,$2,'done')", [TASK.A, U.studentA]);
    await mustFail(U.studentA, "insert into task_progress(task_id,student_id,state) values ($1,$2,'done')", [TASK.A, S.sA2]);
    await mustFail(U.studentA, "insert into task_progress(task_id,student_id,state) values ($1,$2,'done')", [TASK.B, U.studentA]);
    await mustFail(U.studentA, "insert into enrollments(circle_id,student_id) values ($1,$2)", [CIRCLE.B, U.studentA]);
    await mustFail(U.studentA, "insert into roles(profile_id,circle_id,role) values ($1,$2,'admin')", [U.studentA, CIRCLE.A]);
  });

  it('الطالب لا يرى ملخصًا قبل النشر، ويراه بعده', async () => {
    expect(await count(U.studentA, 'select count(*)::int n from summaries')).toBe(0);
    await sup(async (c) => {
      await c.query("update summaries set status='published', published_at=now() where session_id=$1", [SESS.A]);
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U.studentA]);
      expect(Number((await c.query('select count(*)::int n from summaries')).rows[0].n)).toBe(1);
    });
  });

  it('مستخدم مسجَّل بلا أي دور: يرى المجالس العامة والقوالب فقط', async () => {
    expect(await count(U.outsider, `select count(*)::int n from circles where id='${CIRCLE.A}'`)).toBe(1);
    expect(await count(U.outsider, `select count(*)::int n from circles where id='${CIRCLE.B}'`)).toBe(0);
    expect(await count(U.outsider, 'select count(*)::int n from wa_templates')).toBeGreaterThan(0);
    for (const t of ['enrollments', 'sessions', 'tasks', 'payments', 'attendance', 'summaries', 'sheikh_notes', 'audit_log', 'contacts_log', 'fee_plans']) {
      expect(await count(U.outsider, `select count(*)::int n from ${t}`), t).toBe(0);
    }
    expect(await count(U.outsider, `select count(*)::int n from profiles where id <> '${U.outsider}'`)).toBe(0);
    await mustFail(U.outsider, "insert into enrollments(circle_id,student_id) values ($1,$2)", [CIRCLE.A, U.outsider]);
    await mustFail(U.outsider, "insert into roles(profile_id,circle_id,role) values ($1,$2,'admin')", [U.outsider, CIRCLE.A]);
    await mustFail(U.outsider, "insert into circles(name) values ('اختراق')");
    await mustFail(U.outsider, "insert into wa_templates(key,label,body) values ('k','l','b')");
    await mustFail(U.outsider, 'insert into sessions(circle_id,held_at) values ($1, now())', [CIRCLE.A]);
  });

  it('الحساب الجديد غير المنتمي لمجلس يراه المدير (ليُسنِد له دورًا) ولا يراه غيره', async () => {
    expect(await count(U.adminA, `select count(*)::int n from profiles where id='${U.newcomer}'`)).toBe(1);
    expect(await count(U.contactA, `select count(*)::int n from profiles where id='${U.newcomer}'`)).toBe(0);
    expect(await count(U.outsider, `select count(*)::int n from profiles where id='${U.newcomer}'`)).toBe(0);
  });

  it('لا أحد يغيّر هوية ملفه الشخصي (id)', async () => {
    await mustFail(U.outsider, 'update profiles set id=$2 where id=$1', [U.outsider, id(999)]);
  });
});

suite('إضافة طالب (add_student)', () => {
  it('مسؤول التواصل يضيف طالبًا فيدخل نطاقه ويراه فورًا', async () => {
    await as(U.contactA, async (c) => {
      const r = await attempt(c, 'select add_student($1,$2,$3,$4) as id', [CIRCLE.A, 'طالب جديد', '01099999999', 20]);
      expect(r.ok).toBe(true);
      const newId = firstId(r);
      expect(Number((await c.query('select count(*)::int n from assignments where student_id=$1', [newId])).rows[0].n)).toBe(1);
      expect(Number((await c.query('select count(*)::int n from profiles where id=$1', [newId])).rows[0].n)).toBe(1);
    });
  });

  it('المدير يضيف طالبًا (بلا إسناد تلقائي لأنه ليس مسؤول تواصل)', async () => {
    await as(U.adminA, async (c) => {
      const r = await attempt(c, 'select add_student($1,$2) as id', [CIRCLE.A, 'طالب بيد المدير']);
      expect(r.ok).toBe(true);
      const newId = firstId(r);
      expect(Number((await c.query('select count(*)::int n from assignments where student_id=$1', [newId])).rows[0].n)).toBe(0);
    });
  });

  it.each([
    ['اسم فارغ', ['   ']],
    ['سن أقل من ٥', ['س', null, 3]],
    ['سن أكبر من ١٢٠', ['س', null, 121]],
    ['اسم أطول من ١٢٠', ['ا'.repeat(121)]],
    ['هاتف أطول من ٣٠', ['س', '1'.repeat(31)]],
  ])('يرفض %s', async (_n, args) => {
    const params = [CIRCLE.A, ...(args as unknown[])];
    const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
    await mustFail(U.adminA, `select add_student(${placeholders})`, params);
  });

  it('يرفضه لمن لا دور له أو لمجلس غير مجلسه', async () => {
    await mustFail(U.outsider, 'select add_student($1,$2)', [CIRCLE.A, 'س'], /صلاحية/);
    await mustFail(U.attA, 'select add_student($1,$2)', [CIRCLE.A, 'س'], /صلاحية/);
    await mustFail(U.finA, 'select add_student($1,$2)', [CIRCLE.A, 'س'], /صلاحية/);
    await mustFail(U.contactA, 'select add_student($1,$2)', [CIRCLE.B, 'س'], /صلاحية/);
  });
});

suite('الإيصالات والرسوم', () => {
  it('الدفعة بمبلغ موجب فقط', async () => {
    await mustFail(U.finA, 'insert into payments(enrollment_id,amount) values ($1,0)', [E.A1], /أكبر من صفر/);
    await mustFail(U.finA, 'insert into payments(enrollment_id,amount) values ($1,-5)', [E.A1], /أكبر من صفر/);
  });

  it('المحصِّل يُسجَّل من حساب المُنفِّذ ولو أرسل غيره', async () => {
    await as(U.finA, async (c) => {
      const r = await attempt(c, 'insert into payments(enrollment_id,amount,collected_by) values ($1,10,$2) returning collected_by', [E.A1, U.adminA]);
      expect(r.ok && r.rows[0].collected_by).toBe(U.finA);
    });
  });

  it('القيد العكسي: صحيح مرة واحدة فقط، بسالب المبلغ وبسبب', async () => {
    await as(U.finA, async (c) => {
      const base = [E.A1, PAY.A];
      const bad1 = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of,note) values ($1,-40,$2,$3)', [...base, 'x']);
      expect(!bad1.ok && bad1.error.message).toMatch(/سالب/);
      const bad2 = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of) values ($1,-100,$2)', base);
      expect(!bad2.ok && bad2.error.message).toMatch(/سبب/);
      const bad3 = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of,note) values ($1,-100,$2,$3)', [E.A2, PAY.A, 'x']);
      expect(bad3.ok).toBe(false); // انتساب مختلف
      const ok = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of,note) values ($1,-100,$2,$3) returning id', [...base, 'خطأ إدخال']);
      expect(ok.ok).toBe(true);
      const dup = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of,note) values ($1,-100,$2,$3)', [...base, 'مرة ثانية']);
      expect(!dup.ok && dup.error.code).toBe('23505');
      const revId = firstId(ok);
      const rev2 = await attempt(c, 'insert into payments(enrollment_id,amount,reversal_of,note) values ($1,100,$2,$3)', [E.A1, revId, 'عكس العكس']);
      expect(!rev2.ok && rev2.error.message).toMatch(/لا يُعكس/);
      const bal = await c.query('select paid, remaining from v_enrollment_balance where enrollment_id=$1', [E.A1]);
      expect(Number(bal.rows[0].paid)).toBe(0);
      expect(Number(bal.rows[0].remaining)).toBe(300);
    });
  });

  it('الإيصال لا يُعدَّل ولا يُحذف أبدًا، حتى للمالك', async () => {
    for (const sql of ['update payments set amount=1', 'delete from payments']) {
      await sup(async (c) => {
        const r = await attempt(c, sql);
        expect(r.ok, sql).toBe(false);
        if (!r.ok) expect(r.error.message).toMatch(/إيصال/);
      });
    }
    await mustAffectNothing(U.finA, 'update payments set amount=1');
    await mustAffectNothing(U.adminA, 'delete from payments');
  });

  it('الإعفاء يُسقط المستحق إلى صفر، ومن لا خطة له مستحقه صفر', async () => {
    await as(U.adminA, async (c) => {
      await c.query("update enrollments set exempt_reason='يتيم' where id=$1", [E.A1]);
      const r = await c.query('select due, remaining from v_enrollment_balance where enrollment_id=$1', [E.A1]);
      expect(Number(r.rows[0].due)).toBe(0);
      expect(Number(r.rows[0].remaining)).toBeLessThanOrEqual(0); // دفع ١٠٠ لكنه معفى
      await c.query('update enrollments set exempt_reason=null, fee_plan_id=null where id=$1', [E.A1]);
      const r2 = await c.query('select due from v_enrollment_balance where enrollment_id=$1', [E.A1]);
      expect(Number(r2.rows[0].due)).toBe(0);
    });
  });
});

suite('الملخص والنشر', () => {
  it('مسؤول التفريغ: مسودة وإرسال للاعتماد فقط', async () => {
    await mustFail(U.transA, "insert into summaries(session_id,summary_md,status,published_at) values ($1,'x','published',now())", [SESS.B]);
    await mustAffect(U.transA, "update summaries set summary_md='محدّث', status='pending_review' where session_id=$1", [SESS.A]);
    await mustFail(U.transA, "update summaries set status='published', published_at=now() where session_id=$1", [SESS.A]);
    await mustFail(U.transA, 'update summaries set approved_by=$2 where session_id=$1', [SESS.A, U.transA]);
  });

  it('لا يعدّل ملخصًا نُشر، والمدير يعتمد وينشر', async () => {
    await mustAffect(U.adminA, "update summaries set status='published', published_at=now(), approved_by=$2 where session_id=$1", [SESS.A, U.adminA]);
    await as(U.adminA, async (c) => {
      await c.query("update summaries set status='published', published_at=now(), approved_by=$2 where session_id=$1", [SESS.A, U.adminA]);
    });
    await sup(async (c) => {
      await c.query("update summaries set status='published', published_at=now() where session_id=$1", [SESS.A]);
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U.transA]);
      const r = await attempt(c, "update summaries set summary_md='تلاعب' where session_id=$1", [SESS.A]);
      expect(r.ok && r.rowCount).toBe(0);
    });
  });
});

suite('آخر مدير لا يُسحب', () => {
  it('لا يسحب مدير نفسه إن كان الأخير (حتى من SQL مباشرة)', async () => {
    await mustFail(U.adminB, 'update roles set revoked_at=now() where id=$1', [R.adminB], /آخر مدير/);
    await mustFail(U.adminB, "update roles set role='sheikh' where id=$1", [R.adminB], /آخر مدير/);
    await mustFail(U.adminB, 'delete from roles where id=$1', [R.adminB], /آخر مدير/);
    await sup(async (c) => {
      const r = await attempt(c, 'update roles set revoked_at=now() where id=$1', [R.adminB]);
      expect(!r.ok && r.error.message).toMatch(/آخر مدير/);
    });
  });

  it('حذف حساب آخر مدير يُمنع', async () => {
    await sup(async (c) => {
      const r = await attempt(c, 'delete from auth.users where id=$1', [U.adminB]);
      expect(!r.ok && r.error.message).toMatch(/آخر مدير/);
    });
  });

  it('بعد إسناد مدير ثانٍ يصبح السحب ممكنًا', async () => {
    await as(U.adminB, async (c) => {
      expect((await attempt(c, "insert into roles(profile_id,circle_id,role) values ($1,$2,'admin')", [U.outsider, CIRCLE.B])).ok).toBe(true);
      expect((await attempt(c, 'update roles set revoked_at=now() where id=$1', [R.adminB])).ok).toBe(true);
    });
  });

  it('سحب دور غير المدير لا يتأثر', async () => {
    await mustAffect(U.adminA, 'update roles set revoked_at=now() where id=$1', [R.sheikhA]);
  });
});

suite('سجل التدقيق', () => {
  it('لا يُعدَّل ولا يُحذف من أحد، ولا يكتبه المستخدم مباشرة', async () => {
    await sup(async (c) => {
      for (const sql of ['update audit_log set action=\'x\'', 'delete from audit_log']) {
        const r = await attempt(c, sql);
        expect(r.ok, sql).toBe(false);
        if (!r.ok) expect(r.error.message).toMatch(/للقراءة فقط/);
      }
    });
    await mustFail(U.adminA, "insert into audit_log(entity,action) values ('x','y')", [], /permission denied/);
    await mustFail(U.adminA, "update audit_log set action='x'", [], /permission denied/);
    await mustFail(U.adminA, 'delete from audit_log', [], /permission denied/);
  });

  it('كل عملية تُسجَّل باسم فاعلها وفي مجلسها الصحيح', async () => {
    await as(U.adminA, async (c) => {
      const { rows: r } = await c.query("insert into payments(enrollment_id,amount) select id, 7 from enrollments where id=$1 returning id", [E.A2]);
      const log = await c.query("select actor_id, circle_id, action from audit_log where entity='payments' and entity_id=$1", [r[0].id]);
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ actor_id: U.adminA, circle_id: CIRCLE.A, action: 'INSERT' });
    });
  });
});

suite('حدود المدخلات والروابط', () => {
  it('الاسم الطويل جدًا يُرفض في ملف الطالب والملاحظة الضخمة تُرفض', async () => {
    await sup(async (c) => {
      const r = await attempt(c, 'insert into profiles(full_name) values ($1)', ['ا'.repeat(121)]);
      expect(!r.ok && r.error.code).toBe('23514');
      const n = await attempt(c, 'insert into sheikh_notes(student_id,body) values ($1,$2)', [S.sA1, 'ن'.repeat(5001)]);
      expect(!n.ok && n.error.code).toBe('23514');
      const s = await attempt(c, 'update summaries set summary_md=$1 where session_id=$2', ['م'.repeat(100001), SESS.A]);
      expect(!s.ok && s.error.code).toBe('23514');
    });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x.y', ' https://x.y'])('رابط التسجيل «%s» مرفوض', async (url) => {
    await mustFail(U.adminA, 'update sessions set recording_url=$2 where id=$1', [SESS.A, url], /chk_session_url_http|check/);
  });

  it('روابط http/https المشروعة مقبولة', async () => {
    await mustAffect(U.adminA, 'update sessions set recording_url=$2 where id=$1', [SESS.A, 'https://youtu.be/abc']);
    await mustAffect(U.adminA, 'update sessions set recording_url=null where id=$1', [SESS.A]);
  });

  it('مبلغ الخطة سالب أو خيالي مرفوض', async () => {
    await mustFail(U.adminA, "insert into fee_plans(circle_id,name,total_amount) values ($1,'x',-1)", [CIRCLE.A]);
    await mustFail(U.adminA, "insert into fee_plans(circle_id,name,total_amount) values ($1,'x',1e12)", [CIRCLE.A]);
  });

  it('لا يتكرر التكليف نفسه في الجلسة (مع اختلاف الحالة والمسافات)', async () => {
    await mustFail(U.adminA, "insert into tasks(session_id,type,title) values ($1,'worship','  ورد أ ')", [SESS.A], /duplicate|unique/);
    await mustAffect(U.adminA, "insert into tasks(session_id,type,title) values ($1,'activity','ورد أ')", [SESS.A]); // نوع آخر مسموح
  });

  it('التسجيل لا يفشل باسم طويل، ويقصّ الاسم ويملأ بديلًا عند الفراغ', async () => {
    await sup(async (c) => {
      await c.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [id(901), 'long@x.com', JSON.stringify({ full_name: 'ا'.repeat(500), phone: '1'.repeat(99) })]);
      await c.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [id(902), 'blank@x.com', JSON.stringify({ full_name: '   ' })]);
      const r = await c.query('select id, full_name, phone from profiles where id in ($1,$2)', [id(901), id(902)]);
      const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
      expect(byId[id(901)].full_name).toHaveLength(120);
      expect(byId[id(901)].phone).toHaveLength(30);
      expect(byId[id(902)].full_name).toBe('blank');
    });
  });
});

suite('سلامة الملف المولَّد', () => {
  it('إعادة تشغيل setup_all.sql آمنة ولا تضاعف السياسات ولا القوالب', async () => {
    const before = await db.query('select (select count(*) from pg_policies)::int p, (select count(*) from wa_templates)::int t, (select count(*) from pg_trigger where not tgisinternal)::int g');
    await db.query(setupSql());
    const after = await db.query('select (select count(*) from pg_policies)::int p, (select count(*) from wa_templates)::int t, (select count(*) from pg_trigger where not tgisinternal)::int g');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('كل جداول public عليها RLS مفعّل', async () => {
    const r = await db.query("select tablename from pg_tables where schemaname='public' and not rowsecurity");
    expect(r.rows).toEqual([]);
  });

  it('كل دوال security definer تثبّت search_path (تمنع اختطاف الدوال)', async () => {
    const r = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosecdef and not coalesce(p.proconfig::text,'') like '%search_path%'`,
    );
    expect(r.rows).toEqual([]);
  });

  it('المناظر كلها security_invoker (تحترم RLS)', async () => {
    const r = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='v' and not coalesce(c.reloptions::text,'') like '%security_invoker=true%'`,
    );
    expect(r.rows).toEqual([]);
  });

  it('الزائر anon بلا أي صلاحية على أي جدول أو دالة', async () => {
    const t = await db.query(
      "select count(*)::int n from information_schema.role_table_grants where grantee='anon' and table_schema='public'",
    );
    expect(t.rows[0].n).toBe(0);
    const f = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(f.rows).toEqual([]);
  });
});
