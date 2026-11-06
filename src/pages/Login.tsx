import { useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } },
          });

    if (error) setMsg(error.message);
    else if (mode === 'signup') setMsg('أُنشئ الحساب. تحقق من بريدك إن طُلب التفعيل.');
    setBusy(false);
  }

  if (!isConfigured) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="card p-6">
          <h1 className="text-xl font-bold">خطوة إعداد واحدة</h1>
          <p className="mt-2 text-sm leading-7 text-ink-soft">
            لم تُضبط مفاتيح Supabase بعد. انسخ ملف <code>.env.example</code> إلى <code>.env</code> وضع فيه
            رابط مشروعك ومفتاح <span dir="ltr">anon</span>، ثم أعد تشغيل الخادم.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <h1 className="text-2xl font-bold text-brand-700">مجالس</h1>
        <p className="mt-1 mb-6 text-sm text-ink-soft">إدارة المجالس العلمية التربوية</p>

        {mode === 'signup' && (
          <div className="mb-3">
            <label className="label">الاسم الكامل</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}

        <div className="mb-3">
          <label className="label">البريد الإلكتروني</label>
          <input
            className="field"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mb-4">
          <label className="label">كلمة المرور</label>
          <input
            className="field"
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>

        {msg && <p className="mb-3 text-sm text-rose-700">{msg}</p>}

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'لحظة…' : mode === 'signin' ? 'دخول' : 'إنشاء حساب'}
        </button>

        <button
          type="button"
          className="mt-3 w-full text-sm text-ink-soft hover:text-ink"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'ليس لديك حساب؟ أنشئ واحدًا' : 'لديك حساب؟ ادخل'}
        </button>
      </form>
    </div>
  );
}
