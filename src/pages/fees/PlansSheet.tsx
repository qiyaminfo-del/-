import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { dbMessage } from '@/lib/errors';
import { Sheet } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import type { FeePlan } from '@/lib/types';

/** خطط الرسوم: إنشاء خطة، وتطبيقها على كل الطلاب لفترة (المكرر لنفس الفترة يُتجاهل). */
export default function PlansSheet({
  circleId,
  plans,
  onClose,
  onChanged,
}: {
  circleId: string;
  plans: FeePlan[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<FeePlan | null>(null);

  async function add() {
    const v = Number(amount);
    if (!name.trim() || !Number.isFinite(v) || v <= 0) return setError('اكتب اسم الخطة ومبلغًا أكبر من صفر.');
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from('fee_plans').insert({ circle_id: circleId, name: name.trim(), total_amount: v });
    setBusy(false);
    if (e) return setError(dbMessage(e));
    setName('');
    setAmount('');
    onChanged();
  }

  return (
    <Sheet open onClose={onClose} title="خطط الرسوم">
      {info && <p className="mb-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">{info}</p>}
      {plans.length > 0 && (
        <div className="mb-5 space-y-2">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl bg-stone-50 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.name}</p>
                <p className="text-xs text-ink-soft">{formatMoney(Number(p.total_amount), p.currency)}</p>
              </div>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setApplying(p)}>
                تطبيق على الطلاب
              </button>
            </div>
          ))}
        </div>
      )}

      <h4 className="mb-2 text-sm font-semibold">خطة جديدة</h4>
      <label className="label" htmlFor="plan-name">اسم الخطة</label>
      <input id="plan-name" className="field" maxLength={120} placeholder="مثال: الفصل الأول" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label mt-3" htmlFor="plan-amount">المبلغ</label>
      <input id="plan-amount" className="field" type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void add()}>
        إضافة خطة
      </button>

      {applying && (
        <ApplyPlan
          plan={applying}
          onClose={() => setApplying(null)}
          onDone={(count) => {
            setApplying(null);
            setInfo(count ? `أُنشئت رسوم لـ ${count} طالب.` : 'كل الطلاب لديهم هذه الخطة لنفس الفترة من قبل.');
            onChanged();
          }}
        />
      )}
    </Sheet>
  );
}

function ApplyPlan({ plan, onClose, onDone }: { plan: FeePlan; onClose: () => void; onDone: (count: number) => void }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (start && end && end < start) return setError('نهاية الفترة قبل بدايتها.');
    setBusy(true);
    const { data, error: e } = await supabase.rpc('create_plan_dues', {
      p_plan: plan.id,
      p_period_start: start || null,
      p_period_end: end || null,
    });
    setBusy(false);
    if (e) return setError(dbMessage(e));
    onDone(Number(data ?? 0));
  }

  return (
    <Sheet open onClose={onClose} title={`تطبيق «${plan.name}»`}>
      <p className="mb-4 text-sm text-ink-soft">
        تُنشأ رسوم بمبلغ {formatMoney(Number(plan.total_amount))} لكل طالب في نطاقك. من سبق إنشاؤها له لنفس الفترة لا تتكرر.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ap-start">من تاريخ</label>
          <input id="ap-start" className="field" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ap-end">إلى تاريخ</label>
          <input id="ap-end" className="field" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary mt-5 w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? 'جارٍ الإنشاء…' : 'إنشاء الرسوم'}
      </button>
    </Sheet>
  );
}
