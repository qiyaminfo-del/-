import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- بطاقة ---------- */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

/* ---------- عنوان الصفحة ---------- */
export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- لا شاشة فارغة بلا إرشاد ---------- */
export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1.5 text-sm text-ink-soft">{hint}</p>
    </div>
  );
}

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return <div className="py-10 text-center text-sm text-ink-soft">{label}</div>;
}

/* ---------- كل رقم قابل للضغط ---------- */
export function Stat({
  label,
  value,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
}) {
  const tones = {
    neutral: 'text-ink',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    bad: 'text-rose-700',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`card p-3 text-center ${onClick ? 'hover:bg-stone-50 active:scale-[.98] transition' : ''}`}
    >
      <div className={`text-2xl font-bold ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-soft">{label}</div>
    </Tag>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700',
    good: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-rose-100 text-rose-800',
    info: 'bg-sky-100 text-sky-800',
  };
  return <span className={`chip ${tones[tone]}`}>{children}</span>;
}

/* ---------- حقل بحفظ تلقائي، بلا زر حفظ ---------- */
export function AutoField({
  label,
  value,
  onSave,
  type = 'text',
  placeholder,
  dir,
}: {
  label: string;
  value: string | number | null;
  onSave: (v: string) => Promise<void> | void;
  type?: string;
  placeholder?: string;
  dir?: 'rtl' | 'ltr';
}) {
  const [local, setLocal] = useState(value == null ? '' : String(value));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<number>();
  const first = useRef(true);

  useEffect(() => {
    setLocal(value == null ? '' : String(value));
  }, [value]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.clearTimeout(timer.current);
    setState('saving');
    timer.current = window.setTimeout(async () => {
      await onSave(local);
      setState('saved');
      window.setTimeout(() => setState('idle'), 1500);
    }, 600);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label">{label}</label>
        {state === 'saving' && <span className="text-xs text-ink-faint">…</span>}
        {state === 'saved' && <span className="text-xs text-emerald-600">تم الحفظ</span>}
      </div>
      <input
        className="field"
        type={type}
        dir={dir}
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
    </div>
  );
}

/* ---------- نافذة منبثقة بسيطة ---------- */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 sm:max-w-lg sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-stone-100">
            إغلاق
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- شريط تقدم ---------- */
export function Bar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'good' | 'warn' | 'bad' }) {
  const colors = {
    brand: 'bg-brand-600',
    good: 'bg-emerald-600',
    warn: 'bg-amber-500',
    bad: 'bg-rose-500',
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
      <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
