/**
 * عميل Supabase وهمي لمعاينة التصميم ببيانات تجريبية (لا اتصال بأي خادم).
 * يُفعَّل فقط بـ VITE_DESIGN_MOCK=1 عبر alias في vite.config.ts، ولا يدخل في نسخة الإنتاج أبدًا
 * (يتحقق من ذلك tests/unit/security.test.ts).
 */
type Row = Record<string, unknown>;

const day = 86_400_000;
const at = (offsetDays: number, hour = 20) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const NAMES = [
  ['أحمد الشريف', 'كلية الهندسة', 'مدني', 21],
  ['يوسف بن إبراهيم', 'كلية الطب', 'بشري', 22],
  ['عمر الخطيب', 'كلية الشريعة', 'فقه', 20],
  ['إسلام مصطفى', 'كلية التجارة', 'محاسبة', 23],
  ['خالد عبد الرحمن', 'كلية العلوم', 'كيمياء', 19],
  ['محمود السيد', 'كلية الحاسبات', 'ذكاء اصطناعي', 21],
  ['بلال حسن', 'كلية الصيدلة', 'صيدلة', 22],
  ['عبد الله فؤاد', 'كلية الآداب', 'تاريخ', 20],
  ['زياد منصور', 'كلية الألسن', 'لغة عربية', 24],
  ['أنس الدسوقي', 'كلية الحقوق', 'قانون', 21],
] as const;

const students: Row[] = NAMES.map(([full_name, university, major, age], i) => ({
  id: `st${i}`,
  full_name,
  university,
  major,
  age,
  city: 'القاهرة',
  phone: `010${String(10000000 + i * 1371).slice(0, 8)}`,
}));

const officers: Row[] = [
  { id: 'me', full_name: 'محسن علي', phone: '01000000000' },
  { id: 'o1', full_name: 'هشام عبد العزيز' },
  { id: 'o2', full_name: 'طارق السعدني' },
  { id: 'o3', full_name: 'مصطفى عادل' },
  { id: 'o4', full_name: 'كريم رضوان' },
  { id: 'o5', full_name: 'ياسر بدوي' },
];

const circles: Row[] = [
  { id: 'c1', name: 'المجلس العام', type: 'public', location: 'مسجد الرحمن', schedule_rule: 'كل سبت ٨ مساءً', parent_circle_id: null, is_active: true },
  { id: 'c2', name: 'فريق العمل', type: 'private', location: 'مقر الفريق', schedule_rule: 'كل خميس ٩ مساءً', parent_circle_id: 'c1', is_active: true },
];

const enrollments: Row[] = students.map((s, i) => ({
  id: `en${i}`, circle_id: 'c1', student_id: s.id, fee_plan_id: i === 3 ? null : 'fp1', exempt_reason: i === 8 ? 'يتيم' : null, status: 'active',
}));

const paid = [300, 150, 300, 0, 100, 300, 0, 50, 0, 200];
const balance: Row[] = students.map((s, i) => {
  const exempt = i === 8;
  const due = exempt || i === 3 ? 0 : 300;
  return {
    enrollment_id: `en${i}`, circle_id: 'c1', student_id: s.id, full_name: s.full_name, due, paid: paid[i],
    remaining: due - paid[i], last_paid_at: paid[i] ? at(-(i + 2), 12) : null,
    fee_plan_id: i === 3 ? null : 'fp1', exempt_reason: exempt ? 'يتيم' : null,
  };
});

const state = ['present', 'present', 'late', 'absent', 'present', 'excused', null, 'present', null, 'late'] as const;

const tables: Record<string, Row[]> = {
  profiles: [...officers, ...students],
  circles,
  fee_plans: [{ id: 'fp1', circle_id: 'c1', name: 'الفصل الدراسي الأول', total_amount: 300, installments: 3, currency: 'EGP' }],
  enrollments,
  roles: [
    { id: 'r1', profile_id: 'me', circle_id: 'c1', role: 'admin', revoked_at: null },
    { id: 'r2', profile_id: 'o1', circle_id: 'c1', role: 'contact_officer', revoked_at: null },
    { id: 'r3', profile_id: 'o2', circle_id: 'c1', role: 'attendance_officer', revoked_at: null },
    { id: 'r4', profile_id: 'o3', circle_id: 'c1', role: 'finance_officer', revoked_at: null },
    { id: 'r5', profile_id: 'o4', circle_id: 'c1', role: 'tasks_officer', revoked_at: null },
    { id: 'r6', profile_id: 'o5', circle_id: 'c1', role: 'transcription_officer', revoked_at: null },
  ],
  assignments: ['r2', 'r3', 'r4', 'r5'].flatMap((r, k) =>
    students.slice(0, 6 + k).map((s) => ({ id: `${r}-${s.id}`, role_id: r, student_id: s.id, revoked_at: null })),
  ),
  sessions: [
    { id: 's1', circle_id: 'c1', title: 'مجلس السيرة النبوية', held_at: at(3), status: 'scheduled', recording_url: null },
    { id: 's2', circle_id: 'c1', title: 'مجلس تزكية النفس', held_at: at(-4), status: 'closed', recording_url: null },
    { id: 's3', circle_id: 'c1', title: 'مجلس فقه الصيام', held_at: at(-11), status: 'closed', recording_url: null },
  ],
  attendance: students.flatMap((s, i) => (state[i] ? [{ id: `a${i}`, session_id: 's1', student_id: s.id, state: state[i] }] : [])),
  contacts_log: students.slice(0, 7).map((s, i) => ({
    id: `cl${i}`, session_id: 's1', student_id: s.id, by_profile_id: 'o1',
    outcome: ['confirmed', 'confirmed', 'no_answer', 'apologized', 'confirmed', 'confirmed', 'no_answer'][i],
    contacted_at: at(-i / 2, 18),
  })),
  tasks: [
    { id: 't1', session_id: 's1', type: 'worship', title: 'ورد يومي من سورة البقرة', description: 'صفحتان بعد الفجر', created_at: at(-1) },
    { id: 't2', session_id: 's1', type: 'research', title: 'بحث في معنى الإخلاص', description: null, created_at: at(-1) },
    { id: 't3', session_id: 's1', type: 'activity', title: 'زيارة مريض', description: null, created_at: at(-1) },
  ],
  task_progress: students.flatMap((s, i) =>
    (['done', 'partial', 'stalled', 'not_started'] as const).flatMap((st, k) =>
      (i + k) % 3 === 0 || k === 0
        ? [{ id: `tp${i}-${k}`, task_id: `t${(k % 3) + 1}`, student_id: s.id, state: st === 'not_started' ? 'done' : st, percent: 50, reason: st === 'stalled' ? 'forgot' : null, updated_at: at(-1) }]
        : [],
    ),
  ),
  summaries: [{ id: 'sm2', session_id: 's2', summary_md: '## المحاور\n- الإخلاص', status: 'published', published_at: at(-3) }],
  wa_templates: [
    { id: 'w1', circle_id: null, key: 'invite', label: 'دعوة أولى', body: 'السلام عليكم {اسم_الطالب}، نسعد بدعوتك لحضور {اسم_المجلس}.' },
    { id: 'w2', circle_id: null, key: 'absence', label: 'افتقاد بعد الغياب', body: 'افتقدناك {اسم_الطالب}.' },
    { id: 'w3', circle_id: null, key: 'fee', label: 'تذكير بالرسوم', body: 'تذكير لطيف برسوم {اسم_المجلس}.' },
    { id: 'w4', circle_id: null, key: 'task', label: 'سؤال عن تكليف متعثر', body: 'نتابع معك تكليف هذا الأسبوع.' },
  ],
  sheikh_notes: [],
  payments: [{ id: 'p1', enrollment_id: 'en0', amount: 300, method: 'cash', receipt_no: 1001, paid_at: at(-9, 12), reversal_of: null, note: null }],
  v_enrollment_balance: balance,
  v_student_attendance_stats: students.map((s, i) => ({ circle_id: 'c1', student_id: s.id, total: 5, attended: 5 - (i % 4) })),
  v_session_attendance_summary: [
    { session_id: 's2', circle_id: 'c1', held_at: at(-4), present: 7, late: 1, excused: 1, absent: 1, enrolled: 10 },
    { session_id: 's3', circle_id: 'c1', held_at: at(-11), present: 8, late: 0, excused: 1, absent: 1, enrolled: 10 },
  ],
  v_officer_performance: [
    { circle_id: 'c1', profile_id: 'o1', full_name: 'هشام عبد العزيز', role: 'contact_officer', scope_size: 6, contacted_7d: 6, tasks_updated_7d: 0, settled: 0 },
    { circle_id: 'c1', profile_id: 'o4', full_name: 'كريم رضوان', role: 'tasks_officer', scope_size: 9, tasks_updated_7d: 5, contacted_7d: 0, settled: 0 },
    { circle_id: 'c1', profile_id: 'o3', full_name: 'مصطفى عادل', role: 'finance_officer', scope_size: 8, settled: 3, contacted_7d: 0, tasks_updated_7d: 0 },
    { circle_id: 'c1', profile_id: 'o2', full_name: 'طارق السعدني', role: 'attendance_officer', scope_size: 7, settled: 0, contacted_7d: 0, tasks_updated_7d: 0 },
  ],
};

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private head = false;
  private single = false;
  private sort: { col: string; asc: boolean } | null = null;
  private lo = 0;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.head = Boolean(opts?.head);
    return this;
  }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: unknown) { this.filters.push((r) => Number(r[c]) > Number(v)); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => String(r[c]) >= String(v)); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  or() { return this; }
  order(col: string, o?: { ascending?: boolean }) { this.sort = { col, asc: o?.ascending !== false }; return this; }
  limit() { return this; }
  range(from: number) { this.lo = from; return this; }
  maybeSingle() { this.single = true; return this; }
  insert() { return this; }
  upsert() { return this; }
  update() { return this; }
  delete() { return this; }

  private run() {
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.lo > 0) rows = [];
    return { data: this.head ? null : this.single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
  }

  then<R1 = { data: unknown; error: null; count: number | null }, R2 = never>(
    ok?: ((v: { data: unknown; error: null; count: number | null }) => R1 | PromiseLike<R1>) | null,
    err?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(ok, err);
  }
}

const session = { user: { id: 'me', email: 'demo@majales.local' } };

export const isConfigured = true;
export const supabase = {
  from: (table: string) => new Query(table),
  rpc: () => Promise.resolve({ data: 'new-id', error: null }),
  auth: {
    // ‎?login في الرابط يعرض شاشة الدخول (بلا جلسة)
    getSession: () => Promise.resolve({ data: { session: /[?&]login(&|$)/.test(location.search) ? null : session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    signInWithPassword: () => Promise.resolve({ error: null }),
    signUp: () => Promise.resolve({ error: null }),
  },
};
