/**
 * حسابات الأعضاء باسم مستخدم.
 * Supabase Auth يحتاج بريدًا، فيُحوَّل اسم المستخدم إلى بريد داخلي لا يُراسَل أبدًا.
 * (هذه الثوابت مكررة عمدًا في api/members.ts لأن دوال Vercel تُبنى منفصلة؛ اختبار يتحقق من تطابقها.)
 */
import type { RoleKey } from './types';

export const MEMBER_EMAIL_DOMAIN = 'members.majales.local';
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;

/** الأدوار التي يُسندها المدير للعاملين (الطالب يأتي بالانتساب لا بدور) */
export const STAFF_ROLES: RoleKey[] = [
  'admin',
  'sheikh',
  'contact_officer',
  'attendance_officer',
  'finance_officer',
  'tasks_officer',
  'transcription_officer',
  'member',
];

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

/** ما يكتبه المستخدم في خانة الدخول: بريد كما هو، أو اسم مستخدم يُحوَّل لبريده الداخلي. */
export function toLoginEmail(input: string): string {
  const v = input.trim();
  if (v.includes('@')) return v;
  return `${normalizeUsername(v)}@${MEMBER_EMAIL_DOMAIN}`;
}

export function usernameError(u: string): string | null {
  const v = normalizeUsername(u);
  if (!v) return 'اكتب اسم المستخدم.';
  if (!USERNAME_RE.test(v)) return 'اسم المستخدم من ٣ إلى ٣٢ حرفًا لاتينيًا صغيرًا أو رقمًا أو . _ - ويبدأ بحرف أو رقم.';
  return null;
}

export function passwordError(p: string): string | null {
  if (p.length < MIN_PASSWORD) return `كلمة المرور ${MIN_PASSWORD} أحرف على الأقل.`;
  if (p.length > MAX_PASSWORD) return `كلمة المرور ${MAX_PASSWORD} حرفًا على الأكثر.`;
  return null;
}
