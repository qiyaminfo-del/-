import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Inbox, Loader2, X, type LucideIcon } from 'lucide-react';

/* ---------- بطاقة ---------- */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

/* ---------- عنوان الصفحة ---------- */
export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 animate-rise">
      <div className="min-w-0">
        <h1 className="display text-[30px] leading-tight sm:text-[36px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
        <div className="mt-3 h-[3px] w-10 rounded-full bg-gold-400/80" />
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

/* ---------- لا شاشة فارغة بلا إرشاد ---------- */
export function Empty({ title, hint, icon: Icon = Inbox }: { title: string; hint: string; icon?: LucideIcon }) {
  return (
    <div className="card animate-rise px-6 py-12 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gold-50 text-gold-600 ring-1 ring-gold-200/70">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <p className="display text-2xl">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-7 text-ink-soft">{hint}</p>
    </div>
  );
}

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-16 text-sm text-ink-soft">
      <Loader2 size={18} className="animate-spin text-gold-500" />
      {label}
    </div>
  );
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
    neutral: { num: 'text-ink', bar: 'bg-stone-300' },
    good: { num: 'text-emerald-700', bar: 'bg-emerald-500' },
    warn: { num: 'text-amber-700', bar: 'bg-amber-400' },
    bad: { num: 'text-rose-700', bar: 'bg-rose-500' },
  }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`card relative overflow-hidden px-3 pb-3 pt-4 text-center ${
        onClick ? 'transition hover:-translate-y-px hover:shadow-lift active:scale-[.98]' : ''
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${tones.bar} opacity-70`} />
      <div className={`display text-[32px] leading-none ${tones.num}`}>{value}</div>
      <div className="mt-1.5 text-xs text-ink-soft">{label}</div>
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
    neutral: 'bg-stone-100 text-stone-700 ring-stone-200',
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    bad: 'bg-rose-50 text-rose-800 ring-rose-200',
    info: 'bg-sky-100 text-sky-800 ring-sky-200',
  };
  return <span className={`chip ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
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
  const id = useId();

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
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {state === 'saving' && <span className="text-xs text-ink-faint">…</span>}
        {state === 'saved' && <span className="text-xs text-emerald-600">تم الحفظ</span>}
      </div>
      <input
        id={id}
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

/* ---------- نافذة منبثقة ---------- */
/** النوافذ المفتوحة بترتيب فتحها؛ Esc يخص آخرها */
const sheetStack: string[] = [];

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
  const titleId = useId();

  // Esc يغلق النافذة العليا فقط (عند تراكب نافذتين)، ولا يتحرك ما خلفها
  useEffect(() => {
    if (!open) return;
    sheetStack.push(titleId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === titleId) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      sheetStack.splice(sheetStack.indexOf(titleId), 1);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, titleId]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-950/50 backdrop-blur-[3px] animate-fade sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-white p-6 shadow-sheet animate-sheet sm:max-w-lg sm:rounded-3xl"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 id={titleId} className="display text-2xl">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-stone-100 hover:text-ink"
          >
            <X size={18} />
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
    brand: 'bg-gradient-to-l from-gold-400 to-gold-500',
    good: 'bg-gradient-to-l from-emerald-500 to-emerald-600',
    warn: 'bg-gradient-to-l from-amber-400 to-amber-500',
    bad: 'bg-gradient-to-l from-rose-500 to-rose-600',
  };
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-stone-200/80"
    >
      <div className={`h-full rounded-full transition-[width] duration-700 ${colors[tone]}`} style={{ width: `${v}%` }} />
    </div>
  );
}
