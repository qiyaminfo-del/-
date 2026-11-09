/**
 * دالة Vercel لإدارة حسابات العاملين: إنشاء حساب باسم مستخدم وكلمة مرور، وتغيير كلمة المرور، والتعطيل.
 *
 * لماذا خادم؟ إنشاء حساب بكلمة مرور يحددها المدير يحتاج مفتاح Supabase السري، ولا يجوز أن يصل للمتصفح.
 * الأمان:
 *  - كل طلب يحمل رمز دخول المستخدم؛ والتحقق من أنه «مدير المجلس» يتم في قاعدة البيانات نفسها
 *    (is_circle_admin / member_manageable / set_member_disabled) برمز المستخدم، لا هنا.
 *  - كلمات المرور لا تُخزَّن هنا ولا تُعاد أبدًا؛ Supabase Auth يخزّنها مجزّأة (bcrypt).
 *  - المفتاح السري يُقرأ من متغيرات بيئة Vercel فقط: SUPABASE_SECRET_KEY.
 *
 * ملاحظة: هذا الملف مستقل عن src عمدًا (دوال Vercel تُبنى منفصلة)؛ الثوابت تطابق src/lib/members.ts
 * ويتحقق اختبار من تطابقها.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const MEMBER_EMAIL_DOMAIN = 'members.majales.local';
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;
const STAFF_ROLES = [
  'admin',
  'sheikh',
  'contact_officer',
  'attendance_officer',
  'finance_officer',
  'tasks_officer',
  'transcription_officer',
  'member',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h';

type Json = Record<string, unknown>;

const reply = (status: number, body: Json) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const fail = (status: number, error: string) => reply(status, { error });

function env() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anon, secret };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

function passwordError(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `كلمة المرور ${MIN_PASSWORD} أحرف على الأقل.`;
  if (p.length > MAX_PASSWORD) return `كلمة المرور ${MAX_PASSWORD} حرفًا على الأكثر.`;
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const { url, anon, secret } = env();
  if (!url || !anon || !secret) {
    return fail(503, 'إدارة الحسابات غير مفعّلة: أضف SUPABASE_SECRET_KEY في متغيرات بيئة Vercel ثم أعد النشر.');
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'سجّل الدخول أولًا.');

  let body: Json;
  try {
    const raw = await request.text();
    if (raw.length > 10_000) return fail(413, 'الطلب كبير جدًا.');
    body = JSON.parse(raw) as Json;
  } catch {
    return fail(400, 'صيغة الطلب غير صحيحة.');
  }

  // عميل بصلاحيات المستخدم نفسه: كل تحقق صلاحية يتم في القاعدة
  const asUser = createClient(url, anon, { ...noSession, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who, error: whoErr } = await asUser.auth.getUser(token);
  if (whoErr || !who?.user) return fail(401, 'انتهت جلستك. سجّل الدخول من جديد.');

  const admin = createClient(url, secret, noSession);
  const action = body.action;

  try {
    if (action === 'create') return await createMember(asUser, admin, who.user.id, body);
    if (action === 'set_password') return await setPassword(asUser, admin, body);
    if (action === 'set_disabled') return await setDisabled(asUser, admin, body);
    return fail(400, 'إجراء غير معروف.');
  } catch (e) {
    console.error('[members] خطأ غير متوقع', e);
    return fail(500, 'تعذّر إتمام العملية. أعد المحاولة.');
  }
}

/** أي طريقة غير POST */
export function GET(): Response {
  return fail(405, 'الطريقة غير مسموحة.');
}

async function createMember(asUser: SupabaseClient, admin: SupabaseClient, callerId: string, b: Json): Promise<Response> {
  const circleId = String(b.circle_id ?? '');
  const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
  const roles = Array.isArray(b.roles) ? [...new Set(b.roles.map(String))] : [];

  if (!UUID_RE.test(circleId)) return fail(400, 'المجلس غير محدد.');
  if (!fullName || fullName.length > 120) return fail(400, 'اكتب الاسم الكامل (حتى ١٢٠ حرفًا).');
  if (!USERNAME_RE.test(username)) {
    return fail(400, 'اسم المستخدم من ٣ إلى ٣٢ حرفًا لاتينيًا صغيرًا أو رقمًا أو . _ - ويبدأ بحرف أو رقم.');
  }
  const pErr = passwordError(b.password);
  if (pErr) return fail(400, pErr);
  if (!roles.length) return fail(400, 'اختر دورًا واحدًا على الأقل.');
  if (roles.some((r) => !STAFF_ROLES.includes(r))) return fail(400, 'دور غير صالح.');

  const { data: isAdmin, error: adminErr } = await asUser.rpc('is_circle_admin', { p_circle: circleId });
  if (adminErr || isAdmin !== true) return fail(403, 'إضافة الأعضاء لمدير المجلس فقط.');

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: `${username}@${MEMBER_EMAIL_DOMAIN}`,
    password: String(b.password),
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { username, account_kind: 'staff' },
  });
  if (cErr || !created?.user) {
    if (/already|exists|registered|duplicate/i.test(cErr?.message ?? '')) {
      return fail(409, 'اسم المستخدم مستخدم من قبل. اختر اسمًا آخر.');
    }
    console.error('[members] createUser', cErr);
    return fail(500, 'تعذّر إنشاء الحساب.');
  }
  const newId = created.user.id;

  // الأدوار تُكتب برمز المدير نفسه، فالقاعدة تتحقق من صلاحيته مرة أخرى (RLS)
  const { error: rErr } = await asUser
    .from('roles')
    .insert(roles.map((role) => ({ profile_id: newId, circle_id: circleId, role, granted_by: callerId })));
  if (rErr) {
    await admin.auth.admin.deleteUser(newId); // لا حساب يتيم بلا أدوار
    return fail(403, 'تعذّر إسناد الأدوار؛ لم يُنشأ الحساب.');
  }

  return reply(201, { id: newId, username });
}

async function setPassword(asUser: SupabaseClient, admin: SupabaseClient, b: Json): Promise<Response> {
  const target = String(b.target_id ?? '');
  if (!UUID_RE.test(target)) return fail(400, 'العضو غير محدد.');
  const pErr = passwordError(b.password);
  if (pErr) return fail(400, pErr);

  const { data: can, error } = await asUser.rpc('member_manageable', { p_target: target });
  if (error || can !== true) return fail(403, 'لا تملك صلاحية تغيير كلمة مرور هذا الحساب.');

  const { error: uErr } = await admin.auth.admin.updateUserById(target, { password: String(b.password) });
  if (uErr) {
    console.error('[members] updateUserById', uErr);
    return fail(500, 'تعذّر تغيير كلمة المرور.');
  }
  return reply(200, { ok: true });
}

async function setDisabled(asUser: SupabaseClient, admin: SupabaseClient, b: Json): Promise<Response> {
  const target = String(b.target_id ?? '');
  if (!UUID_RE.test(target)) return fail(400, 'العضو غير محدد.');
  if (typeof b.disabled !== 'boolean') return fail(400, 'حدّد: تعطيل أم تفعيل.');

  // القاعدة تتحقق وتطبّق التعطيل فورًا على كل الصلاحيات
  const { error } = await asUser.rpc('set_member_disabled', { p_target: target, p_disabled: b.disabled });
  if (error) return fail(403, 'لا تملك صلاحية إدارة هذا الحساب.');

  // ومنع الدخول من Supabase Auth (حظر/رفع حظر)
  const { error: bErr } = await admin.auth.admin.updateUserById(target, {
    ban_duration: b.disabled ? BAN_FOREVER : 'none',
  });
  if (bErr) {
    console.error('[members] ban', bErr);
    return reply(200, { ok: true, login_blocked: false, warning: 'عُطّلت الصلاحيات، لكن تعذّر منع الدخول. أعد المحاولة.' });
  }
  return reply(200, { ok: true, login_blocked: b.disabled });
}
