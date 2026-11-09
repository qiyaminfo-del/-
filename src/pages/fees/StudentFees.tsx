import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgePercent, Plus, Receipt, Trash2, Undo2, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dbMessage } from '@/lib/errors';
import { DUE_TONE, exemptionError, paymentError } from '@/lib/fees';
import { Chip, Loading, Sheet } from '@/components/ui';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { DUE_STATUS_LABEL, METHOD_LABEL, type FeeDue, type FeePlan, type Payment, type PaymentMethod } from '@/lib/types';

const n = (v: unknown) => Number(v ?? 0);

/** السجل المالي لطالب: رسومه المستحقة، ودفعات كل منها، والإعفاءات، والقيود العكسية. */
export default function StudentFees({
  enrollmentId,
  studentName,
  plans,
  canManage,
  onClose,
  onChanged,
}: {
  enrollmentId: string;
  studentName: string;
  plans: FeePlan[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [dues, setDues] = useState<FeeDue[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<FeeDue | null>(null);
  const [exempting, setExempting] = useState<FeeDue | null>(null);
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState<{ no: number; amount: number; label: string } | null>(null);

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([
      supabase.from('v_fee_dues').select('*').eq('enrollment_id', enrollmentId).order('created_at'),
      supabase.from('payments').select('*').eq('enrollment_id', enrollmentId).order('paid_at', { ascending: false }),
    ]);
    if (d.error || p.error) setError(dbMessage(d.error ?? p.error));
    setDues(
      ((d.data ?? []) as FeeDue[]).map((x) => ({
        ...x,
        amount: n(x.amount),
        exempt_amount: n(x.exempt_amount),
        net: n(x.net),
        paid: n(x.paid),
        remaining: n(x.remaining),
      })),
    );
    setPayments((p.data ?? []) as Payment[]);
  }, [enrollmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    onChanged();
  };

  const reversed = useMemo(() => new Set(payments.map((p) => p.reversal_of).filter(Boolean) as string[]), [payments]);
  const unlinked = payments.filter((p) => !p.due_id);

  async function reverse(p: Payment) {
    const why = prompt(`سبب عكس الإيصال رقم ${p.receipt_no}؟ (يبقى في السجل)`);
    if (!why?.trim()) return;
    setError(null);
    const { error: e } = await supabase.from('payments').insert({
      enrollment_id: p.enrollment_id,
      amount: -n(p.amount),
      method: p.method,
      reversal_of: p.id,
      note: why.trim().slice(0, 500),
    });
    if (e) return setError(dbMessage(e));
    await changed();
  }

  async function removeDue(d: FeeDue) {
    if (!confirm(`حذف «${d.label}»؟ (لا دفعات عليها)`)) return;
    const { error: e } = await supabase.from('fee_dues').delete().eq('id', d.id);
    if (e) return setError(dbMessage(e));
    await changed();
  }

  return (
    <Sheet open onClose={onClose} title={studentName}>
      {error && <p className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

      {canManage && (
        <button className="btn-ghost mb-4 w-full" onClick={() => setAdding(true)}>
          <Plus size={16} />
          رسوم مستحقة جديدة
        </button>
      )}

      {dues === null ? (
        <Loading />
      ) : dues.length === 0 ? (
        <p className="rounded-xl bg-stone-50 p-4 text-center text-sm text-ink-soft">
          لا رسوم مستحقة على هذا الطالب.{canManage && ' أضفها من الزر أعلاه أو طبّق خطة على الجميع.'}
        </p>
      ) : (
        <div className="space-y-3">
          {dues.map((d) => {
            const dPays = payments.filter((p) => p.due_id === d.id);
            return (
              <div key={d.id} className="rounded-2xl border border-line p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{d.label}</p>
                    {(d.period_start || d.period_end) && (
                      <p className="text-xs text-ink-soft">
                        {d.period_start ? formatDate(d.period_start) : '…'} — {d.period_end ? formatDate(d.period_end) : '…'}
                      </p>
                    )}
                  </div>
                  <Chip tone={DUE_TONE[d.status]}>{DUE_STATUS_LABEL[d.status]}</Chip>
                </div>

                <dl className="grid grid-cols-4 gap-2 rounded-xl bg-stone-50 p-2.5 text-center text-xs">
                  <div>
                    <dt className="text-ink-faint">المبلغ</dt>
                    <dd className="font-semibold">{formatMoney(d.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">إعفاء</dt>
                    <dd className="font-semibold">{formatMoney(d.exempt_amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">مدفوع</dt>
                    <dd className="font-semibold text-emerald-700">{formatMoney(d.paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">متبقٍّ</dt>
                    <dd className={`font-semibold ${d.remaining > 0 ? 'text-rose-700' : ''}`}>{formatMoney(d.remaining)}</dd>
                  </div>
                </dl>
                {d.exempt_reason && <p className="mt-2 text-xs text-ink-soft">سبب الإعفاء: {d.exempt_reason}</p>}

                {canManage && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.remaining > 0 && (
                      <button className="btn-primary px-3 py-2 text-xs" onClick={() => setPaying(d)}>
                        <Wallet size={14} />
                        تسجيل دفعة
                      </button>
                    )}
                    <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setExempting(d)}>
                      <BadgePercent size={14} />
                      إعفاء
                    </button>
                    {d.paid === 0 && !dPays.length && (
                      <button className="btn-ghost px-3 py-2 text-xs text-rose-700" onClick={() => void removeDue(d)}>
                        <Trash2 size={14} />
                        حذف
                      </button>
                    )}
                  </div>
                )}

                {dPays.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {dPays.map((p) => (
                      <PaymentLine
                        key={p.id}
                        p={p}
                        reversed={reversed.has(p.id)}
                        canReverse={canManage}
                        onReverse={() => void reverse(p)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-sm font-semibold">دفعات قديمة غير مربوطة برسوم</h4>
          <ul className="space-y-1.5">
            {unlinked.map((p) => (
              <PaymentLine key={p.id} p={p} reversed={reversed.has(p.id)} canReverse={canManage} onReverse={() => void reverse(p)} />
            ))}
          </ul>
        </div>
      )}

      {paying && (
        <PaySheet
          due={paying}
          enrollmentId={enrollmentId}
          onClose={() => setPaying(null)}
          onPaid={async (no, amount) => {
            setReceipt({ no, amount, label: paying.label });
            setPaying(null);
            await changed();
          }}
        />
      )}
      {exempting && (
        <ExemptSheet due={exempting} onClose={() => setExempting(null)} onSaved={async () => { setExempting(null); await changed(); }} />
      )}
      {adding && (
        <AddDueSheet
          enrollmentId={enrollmentId}
          plans={plans}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await changed();
          }}
        />
      )}
      {receipt && (
        <Sheet open onClose={() => setReceipt(null)} title="تم التحصيل">
          <div className="rounded-2xl bg-brand-50 p-6 text-center ring-1 ring-inset ring-brand-200">
            <Receipt className="mx-auto mb-2 text-brand-700" size={26} />
            <p className="text-sm text-ink-soft">إيصال رقم</p>
            <p className="display text-5xl text-brand-800">{formatNumber(receipt.no)}</p>
            <p className="mt-3 font-semibold">{studentName}</p>
            <p className="text-sm text-ink-soft">{receipt.label}</p>
            <p className="mt-1 text-lg">{formatMoney(receipt.amount)}</p>
            <p className="mt-3 text-xs text-ink-faint">الإيصال لا يُحذف. الخطأ يُصحَّح بقيد عكسي يبقى في السجل.</p>
          </div>
          <button className="btn-ghost mt-3 w-full" onClick={() => setReceipt(null)}>
            تم
          </button>
        </Sheet>
      )}
    </Sheet>
  );
}

function PaymentLine({ p, reversed, canReverse, onReverse }: { p: Payment; reversed: boolean; canReverse: boolean; onReverse: () => void }) {
  const isReversal = Boolean(p.reversal_of);
  return (
    <li className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-inset ring-line">
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${reversed ? 'text-ink-faint line-through' : ''}`}>
          {formatMoney(n(p.amount))} · إيصال {formatNumber(p.receipt_no)}
        </p>
        <p className="truncate text-xs text-ink-soft">
          {METHOD_LABEL[p.method]} · {formatDateTime(p.paid_at)}
          {p.note ? ` · ${p.note}` : ''}
        </p>
      </div>
      {isReversal ? (
        <Chip tone="warn">قيد عكسي</Chip>
      ) : reversed ? (
        <Chip tone="neutral">معكوس</Chip>
      ) : (
        canReverse && (
          <button className="btn-ghost px-2.5 py-1.5 text-xs text-rose-700" onClick={onReverse}>
            <Undo2 size={13} />
            عكس
          </button>
        )
      )}
    </li>
  );
}

function PaySheet({
  due,
  enrollmentId,
  onClose,
  onPaid,
}: {
  due: FeeDue;
  enrollmentId: string;
  onClose: () => void;
  onPaid: (receiptNo: number, amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(due.remaining));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // معرّف ثابت لهذه المحاولة: الضغط المزدوج أو إعادة الإرسال لا تسجّل الدفعة مرتين
  const [clientRef] = useState(() => crypto.randomUUID());

  const vErr = paymentError(amount, due.remaining);

  async function submit() {
    if (vErr) return setError(vErr);
    setBusy(true);
    setError(null);
    const value = Number(amount);
    const { data, error: e } = await supabase
      .from('payments')
      .insert({ enrollment_id: enrollmentId, due_id: due.id, amount: value, method, client_ref: clientRef })
      .select('receipt_no')
      .single();
    setBusy(false);
    if (e) {
      // سُجّلت بالفعل في محاولة سابقة (انقطاع بعد الحفظ): لا تكرار، نعرض الموجود
      if (e.code === '23505') {
        const { data: existing } = await supabase.from('payments').select('receipt_no').eq('client_ref', clientRef).maybeSingle();
        if (existing) return onPaid(existing.receipt_no as number, value);
      }
      return setError(dbMessage(e));
    }
    await onPaid(data.receipt_no as number, value);
  }

  return (
    <Sheet open onClose={onClose} title={`دفعة: ${due.label}`}>
      <p className="mb-3 text-sm text-ink-soft">
        المتبقي <span className="font-semibold text-ink">{formatMoney(due.remaining)}</span> من صافي{' '}
        {formatMoney(due.net)}. الدفع الجزئي مسموح.
      </p>
      <label className="label" htmlFor="pay-amount">المبلغ</label>
      <input
        id="pay-amount"
        className="field text-lg"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        max={due.remaining}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {amount && vErr && <p className="mt-1.5 text-xs text-rose-700">{vErr}</p>}

      <p className="label mt-4">طريقة الدفع</p>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            aria-pressed={method === m}
            className={`btn py-2.5 ${method === m ? 'bg-brand-800 text-white' : 'border border-line bg-white'}`}
          >
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}
      <button className="btn-primary mt-5 w-full" disabled={busy || Boolean(vErr)} onClick={() => void submit()}>
        {busy ? 'جارٍ التسجيل…' : 'تسجيل وإصدار إيصال'}
      </button>
    </Sheet>
  );
}

function ExemptSheet({ due, onClose, onSaved }: { due: FeeDue; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'full' | 'part' | 'none'>(
    due.exempt_amount >= due.amount ? 'full' : due.exempt_amount > 0 ? 'part' : 'part',
  );
  const [amount, setAmount] = useState(String(due.exempt_amount || ''));
  const [reason, setReason] = useState(due.exempt_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = mode === 'full' ? String(due.amount) : mode === 'none' ? '0' : amount;
  const vErr = exemptionError(value, reason, due.amount, due.paid);

  async function submit() {
    if (vErr) return setError(vErr);
    setBusy(true);
    const v = Number(value);
    const { error: e } = await supabase
      .from('fee_dues')
      .update({ exempt_amount: v, exempt_reason: v > 0 ? reason.trim().slice(0, 300) : null })
      .eq('id', due.id);
    setBusy(false);
    if (e) return setError(dbMessage(e));
    await onSaved();
  }

  return (
    <Sheet open onClose={onClose} title={`إعفاء: ${due.label}`}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(
          [
            ['full', 'إعفاء كلي'],
            ['part', 'إعفاء جزئي'],
            ['none', 'إلغاء الإعفاء'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={`rounded-xl border px-2 py-2.5 text-sm ${mode === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-line bg-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'part' && (
        <>
          <label className="label" htmlFor="ex-amount">مبلغ الإعفاء (من {formatMoney(due.amount)})</label>
          <input
            id="ex-amount"
            className="field"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </>
      )}
      {mode !== 'none' && (
        <>
          <label className="label mt-3" htmlFor="ex-reason">سبب الإعفاء (مطلوب)</label>
          <input id="ex-reason" className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      )}
      {due.paid > 0 && <p className="mt-2 text-xs text-ink-faint">مدفوع منها {formatMoney(due.paid)}؛ لا يُعفى ما يجعل المدفوع أكبر من الصافي.</p>}
      {vErr && (mode !== 'part' || amount) && <p className="mt-2 text-xs text-rose-700">{vErr}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}
      <button className="btn-primary mt-5 w-full" disabled={busy || Boolean(vErr)} onClick={() => void submit()}>
        حفظ
      </button>
    </Sheet>
  );
}

function AddDueSheet({
  enrollmentId,
  plans,
  onClose,
  onSaved,
}: {
  enrollmentId: string;
  plans: FeePlan[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [planId, setPlanId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPlan(id: string) {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (p) {
      setLabel(p.name);
      setAmount(String(n(p.total_amount)));
    }
  }

  async function submit() {
    const v = Number(amount);
    if (!label.trim()) return setError('اكتب وصف الرسوم.');
    if (!Number.isFinite(v) || v <= 0) return setError('المبلغ يجب أن يكون أكبر من صفر.');
    if (start && end && end < start) return setError('نهاية الفترة قبل بدايتها.');
    setBusy(true);
    const { error: e } = await supabase.from('fee_dues').insert({
      enrollment_id: enrollmentId,
      fee_plan_id: planId || null,
      label: label.trim().slice(0, 120),
      amount: v,
      period_start: start || null,
      period_end: end || null,
    });
    setBusy(false);
    if (e) return setError(e.code === '23505' ? 'هذه الخطة مسجّلة لهذا الطالب لنفس الفترة من قبل.' : dbMessage(e));
    await onSaved();
  }

  return (
    <Sheet open onClose={onClose} title="رسوم مستحقة جديدة">
      {plans.length > 0 && (
        <>
          <label className="label" htmlFor="due-plan">من خطة (اختياري)</label>
          <select id="due-plan" className="field mb-3" value={planId} onChange={(e) => pickPlan(e.target.value)}>
            <option value="">— مبلغ مخصص —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatMoney(n(p.total_amount))}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="label" htmlFor="due-label">الوصف</label>
      <input id="due-label" className="field" maxLength={120} placeholder="رسوم الفصل الأول" value={label} onChange={(e) => setLabel(e.target.value)} />
      <label className="label mt-3" htmlFor="due-amount">المبلغ</label>
      <input id="due-amount" className="field" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="due-start">من تاريخ</label>
          <input id="due-start" className="field" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="due-end">إلى تاريخ</label>
          <input id="due-end" className="field" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}
      <button className="btn-primary mt-5 w-full" disabled={busy} onClick={() => void submit()}>
        إضافة
      </button>
    </Sheet>
  );
}
