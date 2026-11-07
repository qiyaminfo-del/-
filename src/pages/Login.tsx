import { useState } from 'react';
import { Loader2, ShieldCheck, UsersRound, Wallet } from 'lucide-react';
import { supabase, isConfigured } from '@/lib/supabase';
import { authMessage } from '@/lib/errors';
import { LogoMark, Wordmark } from '@/components/Logo';

const MIN_PASSWORD = 8;

const POINTS = [
  { icon: UsersRound, title: 'تواصل وحضور بلا ضياع', text: 'كل مسؤول يرى طلابه فقط، والحضور يعمل حتى بلا إنترنت.' },
  { icon: Wallet, title: 'رسوم بإيصالات لا تُحذف', text: 'التصحيح بقيد عكسي يبقى في السجل باسم من أجراه.' },
  { icon: ShieldCheck, title: 'صلاحيات محكمة', text: 'الحجب في قاعدة البيانات نفسها، لا في الواجهة.' },
];

/** نقش نجمي ثماني خافت يُكرَّر كخلفية */
const PATTERN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72' fill='none' stroke='%23ffffff' stroke-opacity='.06' stroke-width='1'%3E%3Cpath d='M36 6l8.5 15.5L60 14l-7.5 15.5L66 36l-13.5 6.5L60 58l-15.5-7.5L36 66l-8.5-15.5L12 58l7.5-15.5L6 36l13.5-6.5L12 14l15.5 7.5z'/%3E%3C/svg%3E")`;

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (mode === 'signup') {
      if (!name.trim()) return setMsg('اكتب اسمك الكامل.');
      if (password.length < MIN_PASSWORD) return setMsg(`كلمة المرور ${MIN_PASSWORD} أحرف على الأقل.`);
    }

    setBusy(true);
    try {
      const cleanEmail = email.trim();
      const { error } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email: cleanEmail, password })
          : await supabase.auth.signUp({
              email: cleanEmail,
              password,
              options: { data: { full_name: name.trim().slice(0, 120) } },
            });

      if (error) setMsg(authMessage(error));
      else if (mode === 'signup') setMsg('أُنشئ الحساب. تحقق من بريدك إن طُلب التفعيل.');
    } catch (err) {
      setMsg(authMessage(err as Error));
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="card max-w-md p-8">
          <LogoMark size={44} />
          <h1 className="display mt-4 text-3xl">خطوة إعداد واحدة</h1>
          <p className="mt-2 text-sm leading-7 text-ink-soft">
            لم تُضبط مفاتيح Supabase بعد. انسخ ملف <code>.env.example</code> إلى <code>.env</code> وضع فيه
            رابط مشروعك ومفتاح <span dir="ltr">anon</span>، ثم أعد تشغيل الخادم.
          </p>
        </div>
      </div>
    );
  }

  const isSignin = mode === 'signin';
  const isError = msg && !msg.startsWith('أُنشئ');

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* ===== اللوحة التعريفية ===== */}
      <section
        className="relative hidden overflow-hidden bg-side text-white lg:flex lg:flex-col lg:justify-between lg:p-14"
        style={{ backgroundImage: PATTERN }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(640px_420px_at_85%_0%,rgba(201,162,85,0.2),transparent_70%),radial-gradient(520px_420px_at_0%_100%,rgba(75,119,103,0.28),transparent_70%)]" />
        <div className="relative flex items-center gap-3">
          <LogoMark size={46} />
          <Wordmark className="text-white" />
        </div>

        <div className="relative max-w-lg">
          <p className="mb-4 text-sm font-medium text-gold-300">منصة المجالس العلمية التربوية</p>
          <h2 className="display text-[54px] leading-[1.15] text-white">
            إدارة المجلس
            <br />
            <span className="text-gold-300">بهدوء وإتقان</span>
          </h2>
          <ul className="mt-12 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-gold-300 ring-1 ring-white/10">
                  <p.icon size={21} strokeWidth={1.6} />
                </span>
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-0.5 text-sm leading-7 text-white/55">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/35">مجالس · للاستخدام الداخلي للفريق والطلاب</p>
      </section>

      {/* ===== النموذج ===== */}
      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm animate-rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={44} />
            <Wordmark />
          </div>

          <h1 className="display text-[40px] leading-tight">{isSignin ? 'أهلًا بعودتك' : 'إنشاء حساب'}</h1>
          <p className="mb-7 mt-1.5 text-sm text-ink-soft">
            {isSignin ? 'ادخل لمتابعة عملك في المجلس.' : 'أنشئ حسابك ثم يُسنِد لك المدير دورك.'}
          </p>

          <form onSubmit={submit} noValidate={false}>
            {mode === 'signup' && (
              <div className="mb-4">
                <label className="label" htmlFor="login-name">الاسم الكامل</label>
                <input
                  id="login-name"
                  autoComplete="name"
                  maxLength={120}
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="mb-4">
              <label className="label" htmlFor="login-email">البريد الإلكتروني</label>
              <input
                id="login-email"
                autoComplete="email"
                className="field"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="mb-5">
              <label className="label" htmlFor="login-password">كلمة المرور</label>
              <input
                id="login-password"
                className="field"
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={72}
                autoComplete={isSignin ? 'current-password' : 'new-password'}
              />
            </div>

            {msg && (
              <p
                role="alert"
                className={`mb-4 rounded-xl px-3.5 py-2.5 text-sm ${
                  isError ? 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200' : 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                }`}
              >
                {msg}
              </p>
            )}

            <button className="btn-primary w-full py-3 text-[15px]" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  لحظة…
                </>
              ) : isSignin ? (
                'دخول'
              ) : (
                'إنشاء حساب'
              )}
            </button>

            <button
              type="button"
              className="mt-4 w-full text-sm text-ink-soft transition hover:text-brand-700"
              onClick={() => {
                setMode(isSignin ? 'signup' : 'signin');
                setMsg(null);
              }}
            >
              {isSignin ? 'ليس لديك حساب؟ أنشئ واحدًا' : 'لديك حساب؟ ادخل'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
