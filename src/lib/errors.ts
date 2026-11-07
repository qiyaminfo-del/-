/** رسالة خطأ مفهومة للمستخدم بدل نص قاعدة البيانات الخام. */

interface ErrorLike {
  code?: string;
  message?: string;
}

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'البريد أو كلمة المرور غير صحيحة.'],
  [/email not confirmed/i, 'لم يُفعَّل البريد بعد. افتح رسالة التأكيد في بريدك أولًا.'],
  [/user already registered|already been registered/i, 'هذا البريد مسجَّل من قبل. جرّب الدخول.'],
  [/password should be at least|weak password|password is too short/i, 'كلمة المرور ضعيفة. استخدم ٨ أحرف على الأقل.'],
  [/rate limit|too many requests|over_email_send_rate_limit/i, 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.'],
  [/invalid email|unable to validate email/i, 'صيغة البريد غير صحيحة.'],
  [/failed to fetch|network|load failed/i, 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.'],
];

export function authMessage(e: ErrorLike | null | undefined): string {
  const msg = e?.message ?? '';
  for (const [re, text] of AUTH_MESSAGES) if (re.test(msg)) return text;
  return 'تعذّر إتمام العملية. أعد المحاولة.';
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

/** أخطاء Postgres/PostgREST الشائعة. رسائل القاعدة العربية (من التريجرات) تُعرض كما هي. */
export function dbMessage(e: ErrorLike | null | undefined): string {
  if (!e) return 'تعذّر إتمام العملية.';
  const msg = e.message ?? '';
  if (hasArabic(msg)) return msg;
  switch (e.code) {
    case '42501':
      return 'ليست لديك صلاحية لهذه العملية.';
    case '23505':
      return 'هذا مسجَّل من قبل.';
    case '23503':
      return 'مرتبط ببيانات أخرى، تحقق من صحة الاختيار.';
    case '23514':
      return 'قيمة غير مقبولة (طويلة أكثر من المسموح أو غير صالحة).';
    case '22P02':
      return 'قيمة بصيغة غير صحيحة.';
  }
  if (/row-level security|permission denied/i.test(msg)) return 'ليست لديك صلاحية لهذه العملية.';
  if (/failed to fetch|network|load failed/i.test(msg)) return 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.';
  return 'تعذّر إتمام العملية. أعد المحاولة.';
}
