import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { useApp, useIsSteward } from '@/store/session';
import { useTemplates } from '@/hooks/useSessions';
import { Bar, Card, Chip, Empty, Loading, PageHead, Sheet, Stat } from '@/components/ui';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import { formatDateTime, formatMoney, formatNumber, percent, relativeDay } from '@/lib/format';
import { METHOD_LABEL, type EnrollmentBalance, type FeePlan, type Payment, type PaymentMethod } from '@/lib/types';

interface Row extends EnrollmentBalance {
  phone: string | null;
}

export default function Fees() {
  const { activeCircleId, circles } = useApp();
  const steward = useIsSteward();
  const templates = useTemplates();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [plans, setPlans] = useState<FeePlan[]>([]);
  const [paying, setPaying] = useState<Row | null>(null);
  const [details, setDetails] = useState<Row | null>(null);
  const [editingPlans, setEditingPlans] = useState(false);
  const [receipt, setReceipt] = useState<{ no: number; name: string; amount: number } | null>(null);

  const circle = circles.find((c) => c.id === activeCircleId);

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    const [list, { data: planRows }] = await Promise.all([
      fetchAll<EnrollmentBalance>(
        () => supabase.from('v_enrollment_balance').select('*').eq('circle_id', activeCircleId),
        'enrollment_id',
      ),
      supabase.from('fee_plans').select('*').eq('circle_id', activeCircleId).order('name'),
    ]);

    const people = await selectIn<{ id: string; phone: string | null }>(
      'profiles',
      'id, phone',
      'id',
      list.map((r) => r.student_id),
    );
    const phones = new Map(people.map((p) => [p.id, p.phone]));
    const withPhone: Row[] = list.map((r) => ({
      ...r,
      due: Number(r.due),
      paid: Number(r.paid),
      remaining: Number(r.remaining),
      phone: phones.get(r.student_id) ?? null,
    }));

    withPhone.sort((a, b) => b.remaining - a.remaining);
    setRows(withPhone);
    setPlans((planRows ?? []) as FeePlan[]);
  }, [activeCircleId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const all = rows ?? [];
    const due = all.reduce((s, r) => s + r.due, 0);
    const paid = all.reduce((s, r) => s + r.paid, 0);
    return { due, paid, late: all.filter((r) => r.remaining > 0).length };
  }, [rows]);

  async function record(row: Row, amount: number, method: PaymentMethod): Promise<string | null> {
    const { data, error } = await supabase
      .from('payments')
      .insert({ enrollment_id: row.enrollment_id, amount, method })
      .select('receipt_no')
      .single();

    if (error || !data) return error ? dbMessage(error) : 'تعذّر التسجيل.';
    setPaying(null);
    setReceipt({ no: data.receipt_no as number, name: row.full_name, amount });
    await load();
    return null;
  }

  const feeTemplate = templates.find((t) => t.key === 'fee');

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (rows === null) return <Loading />;

  const noPlans = plans.length === 0;

  return (
    <>
      <PageHead
        title="الرسوم والتحصيل"
        sub="المتأخرون أولًا · اضغط الاسم لسجل الإيصالات"
        action={
          steward && (
            <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setEditingPlans(true)}>
              خطط الرسوم
            </button>
          )
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="المحصَّل" value={formatMoney(totals.paid)} tone="good" />
        <Stat label="المستحق" value={formatMoney(totals.due)} />
        <Stat label="متأخرون" value={formatNumber(totals.late)} tone={totals.late ? 'bad' : 'good'} />
      </div>

      <div className="mb-4">
        <Bar value={percent(totals.paid, totals.due)} tone="good" />
        <p className="mt-1.5 text-xs text-ink-soft">نسبة التحصيل {percent(totals.paid, totals.due)}٪</p>
      </div>

      {noPlans && rows.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <p className="font-semibold">لا توجد خطة رسوم لهذا المجلس</p>
          <p className="mt-1 text-sm text-ink-soft">
            {steward
              ? 'أنشئ خطة من زر «خطط الرسوم»، ثم اربط كل طالب بخطته من سجلّه.'
              : 'اطلب من مدير المنصة إنشاء خطة رسوم وربط الطلاب بها.'}
          </p>
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty title="لا توجد انتسابات" hint="أضف الطلاب من شاشة «قائمتي» أولًا." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.enrollment_id} className="flex items-center gap-3">
              <button className="min-w-0 flex-1 text-start" onClick={() => setDetails(r)}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{r.full_name}</span>
                  {r.exempt_reason ? (
                    <Chip tone="info">معفى</Chip>
                  ) : !r.fee_plan_id ? (
                    <Chip tone="warn">بلا خطة</Chip>
                  ) : r.remaining <= 0 ? (
                    <Chip tone="good">مكتمل</Chip>
                  ) : (
                    <Chip tone="bad">متبقٍّ {formatMoney(r.remaining)}</Chip>
                  )}
                </div>
                <p className="text-xs text-ink-soft">
                  دفع {formatMoney(r.paid)} من {formatMoney(r.due)} · آخر دفعة {relativeDay(r.last_paid_at)}
                </p>
              </button>

              {r.remaining > 0 && isValidPhone(r.phone) && feeTemplate && (
                <button
                  className="btn-wa px-3 py-2 text-xs"
                  onClick={() =>
                    openWhatsApp(
                      r.phone!,
                      fillTemplate(feeTemplate.body, {
                        اسم_الطالب: r.full_name,
                        اسم_المجلس: circle?.name,
                      }),
                    )
                  }
                >
                  تذكير
                </button>
              )}

              <button className="btn-primary px-3 py-2 text-xs" onClick={() => setPaying(r)}>
                تحصيل
              </button>
            </Card>
          ))}
        </div>
      )}

      {paying && <PaySheet row={paying} onClose={() => setPaying(null)} onSubmit={record} />}

      {details && (
        <StudentFees
          row={details}
          plans={plans}
          steward={steward}
          onClose={() => setDetails(null)}
          onChanged={() => void load()}
        />
      )}

      {editingPlans && activeCircleId && (
        <PlansSheet
          circleId={activeCircleId}
          plans={plans}
          onClose={() => setEditingPlans(false)}
          onChanged={() => void load()}
        />
      )}

      {receipt && (
        <Sheet open onClose={() => setReceipt(null)} title="تم التحصيل">
          <div className="card bg-brand-50 p-5 text-center">
            <p className="text-sm text-ink-soft">إيصال رقم</p>
            <p className="display text-5xl text-brand-800">{formatNumber(receipt.no)}</p>
            <p className="mt-3 font-semibold">{receipt.name}</p>
            <p className="text-lg">{formatMoney(receipt.amount)}</p>
            <p className="mt-3 text-xs text-ink-faint">
              الإيصال لا يُحذف. الخطأ يُصحَّح بقيد عكسي يبقى في السجل.
            </p>
          </div>
          <button className="btn-ghost mt-3 w-full" onClick={() => setReceipt(null)}>
            تم
          </button>
        </Sheet>
      )}
    </>
  );
}

function PaySheet({
  row,
  onClose,
  onSubmit,
}: {
  row: Row;
  onClose: () => void;
  onSubmit: (row: Row, amount: number, method: PaymentMethod) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState(String(Math.max(0, row.remaining)));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <Sheet open onClose={onClose} title={`تحصيل من ${row.full_name}`}>
      <label className="label">المبلغ</label>
      <input
        className="field text-lg"
        type="number"
        inputMode="decimal"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {!valid && amount !== '' && <p className="mt-1.5 text-xs text-rose-700">المبلغ يجب أن يكون أكبر من صفر.</p>}

      <label className="label mt-4">طريقة الدفع</label>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`btn py-2.5 ${method === m ? 'bg-brand-700 text-white' : 'border border-line bg-white'}`}
          >
            {METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

      <button
        className="btn-primary mt-5 w-full"
        disabled={busy || !valid}
        onClick={async () => {
          setBusy(true);
          setError(await onSubmit(row, value, method));
          setBusy(false);
        }}
      >
        {busy ? 'جارٍ التسجيل…' : 'تسجيل وإصدار إيصال'}
      </button>
    </Sheet>
  );
}

/* ---------- سجل الطالب: الخطة والإعفاء والإيصالات والقيد العكسي ---------- */
function StudentFees({
  row,
  plans,
  steward,
  onClose,
  onChanged,
}: {
  row: Row;
  plans: FeePlan[];
  steward: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [planId, setPlanId] = useState(row.fee_plan_id ?? '');
  const [exempt, setExempt] = useState(Boolean(row.exempt_reason));
  const [reason, setReason] = useState(row.exempt_reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadPayments = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('payments')
      .select('*')
      .eq('enrollment_id', row.enrollment_id)
      .order('paid_at', { ascending: false });
    if (e) setError(dbMessage(e));
    setPayments((data ?? []) as Payment[]);
  }, [row.enrollment_id]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  async function saveTerms() {
    setError(null);
    if (exempt && !reason.trim()) {
      setError('اذكر سبب الإعفاء.');
      return;
    }
    const { error: e } = await supabase
      .from('enrollments')
      .update({ fee_plan_id: planId || null, exempt_reason: exempt ? reason.trim() : null })
      .eq('id', row.enrollment_id);
    if (e) {
      setError(dbMessage(e));
      return;
    }
    setSaved(true);
    onChanged();
  }

  async function reverse(p: Payment) {
    const why = prompt(`سبب عكس الإيصال رقم ${p.receipt_no}؟ (يبقى في السجل)`);
    if (!why?.trim()) return;
    setError(null);
    const { error: e } = await supabase.from('payments').insert({
      enrollment_id: p.enrollment_id,
      amount: -Number(p.amount),
      method: p.method,
      reversal_of: p.id,
      note: why.trim(),
    });
    if (e) {
      setError(dbMessage(e));
      return;
    }
    await loadPayments();
    onChanged();
  }

  const reversed = new Set((payments ?? []).map((p) => p.reversal_of).filter(Boolean) as string[]);

  return (
    <Sheet open onClose={onClose} title={row.full_name}>
      {steward && (
        <div className="mb-5 space-y-3 rounded-2xl border border-line p-4">
          <div>
            <label className="label">خطة الرسوم</label>
            <select className="field" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">— بلا خطة —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(Number(p.total_amount), p.currency)}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
            معفى من الرسوم
          </label>
          {exempt && (
            <input
              className="field"
              placeholder="سبب الإعفاء (مطلوب)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}

          <button className="btn-primary w-full" onClick={() => void saveTerms()}>
            {saved ? 'تم الحفظ' : 'حفظ الخطة والإعفاء'}
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}

      <h3 className="display mb-2 text-xl">الإيصالات</h3>
      {payments === null ? (
        <Loading />
      ) : payments.length === 0 ? (
        <p className="text-sm text-ink-soft">لم يُحصَّل منه شيء بعد.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => {
            const isReversal = Boolean(p.reversal_of);
            const wasReversed = reversed.has(p.id);
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-stone-50 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold ${wasReversed ? 'text-ink-faint line-through' : ''}`}>
                    {formatMoney(Number(p.amount))} · إيصال {formatNumber(p.receipt_no)}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {METHOD_LABEL[p.method]} · {formatDateTime(p.paid_at)}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                {isReversal ? (
                  <Chip tone="warn">قيد عكسي</Chip>
                ) : wasReversed ? (
                  <Chip tone="neutral">معكوس</Chip>
                ) : (
                  <button className="btn-ghost px-3 py-1.5 text-xs text-rose-700" onClick={() => void reverse(p)}>
                    قيد عكسي
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

/* ---------- خطط رسوم المجلس ---------- */
function PlansSheet({
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
  const [busy, setBusy] = useState(false);

  async function add() {
    const value = Number(amount);
    if (!name.trim() || !Number.isFinite(value) || value < 0) {
      setError('اكتب اسم الخطة ومبلغًا صحيحًا.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e } = await supabase
      .from('fee_plans')
      .insert({ circle_id: circleId, name: name.trim(), total_amount: value });
    setBusy(false);
    if (e) {
      setError(dbMessage(e));
      return;
    }
    setName('');
    setAmount('');
    onChanged();
  }

  return (
    <Sheet open onClose={onClose} title="خطط الرسوم">
      {plans.length > 0 && (
        <div className="mb-5 space-y-2">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-stone-50 p-3 text-sm">
              <span className="font-semibold">{p.name}</span>
              <span>{formatMoney(Number(p.total_amount), p.currency)}</span>
            </div>
          ))}
        </div>
      )}

      <label className="label">اسم الخطة</label>
      <input className="field" placeholder="مثال: الفصل الأول" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label mt-3">المبلغ الكلي</label>
      <input
        className="field"
        type="number"
        inputMode="decimal"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void add()}>
        إضافة خطة
      </button>
    </Sheet>
  );
}
