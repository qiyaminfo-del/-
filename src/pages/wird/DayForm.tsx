import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dbMessage } from '@/lib/errors';
import { buildDay, localDay, shiftDay } from '@/lib/wird';
import { formatDate } from '@/lib/format';
import { Bar, Empty, Loading } from '@/components/ui';
import type { StudentLevel, WirdLog } from '@/lib/types';
import { levelOnDay, type WirdCatalog } from './data';

/** أوراد يوم واحد لطالب: تُحفظ كل عبادة فور تعديلها. */
export default function DayForm({
  circleId,
  studentId,
  catalog,
  emptyHint,
}: {
  circleId: string;
  studentId: string;
  catalog: WirdCatalog;
  emptyHint: string;
}) {
  const today = localDay();
  const [day, setDay] = useState(today);
  const [history, setHistory] = useState<StudentLevel[] | null>(null);
  const [logs, setLogs] = useState<WirdLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('student_levels')
      .select('*')
      .eq('circle_id', circleId)
      .eq('student_id', studentId)
      .order('started_at');
    if (e) setError(dbMessage(e));
    setHistory((data ?? []) as StudentLevel[]);
  }, [circleId, studentId]);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase.from('wird_logs').select('*').eq('student_id', studentId).eq('day', day);
    setLogs(((data ?? []) as WirdLog[]).map((l) => ({ ...l, value: l.value == null ? null : Number(l.value) })));
  }, [studentId, day]);

  useEffect(() => {
    setHistory(null);
    void loadHistory();
  }, [loadHistory]);
  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  async function save(itemId: string, patch: { done?: boolean; value?: number }) {
    setError(null);
    setSaving(itemId);
    // تحديث فوري للواجهة، ثم الحفظ
    setLogs((prev) => {
      const rest = prev.filter((l) => l.item_id !== itemId);
      const old = prev.find((l) => l.item_id === itemId);
      return [...rest, { ...(old ?? { id: 'tmp', student_id: studentId, item_id: itemId, day, level_id: null, done: null, value: null }), ...patch }];
    });
    const { error: e } = await supabase
      .from('wird_logs')
      .upsert(
        { student_id: studentId, item_id: itemId, day, done: patch.done ?? null, value: patch.value ?? null },
        { onConflict: 'student_id,item_id,day' },
      );
    setSaving(null);
    if (e) {
      setError(dbMessage(e));
      void loadLogs();
    }
  }

  if (history === null) return <Loading />;

  const levelId = levelOnDay(history, day);
  const level = catalog.levels.find((l) => l.id === levelId);
  const { rows, done, total, percent } = buildDay(
    catalog.levelItems.filter((li) => li.level_id === levelId),
    catalog.items,
    logs,
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          className="btn-ghost px-2.5 py-2"
          aria-label="اليوم السابق"
          onClick={() => setDay((d) => shiftDay(d, -1))}
        >
          <ChevronRight size={18} />
        </button>
        <div className="text-center">
          <p className="display text-2xl">{day === today ? 'اليوم' : day === shiftDay(today, -1) ? 'أمس' : formatDate(day)}</p>
          {day !== today && day !== shiftDay(today, -1) ? null : <p className="text-xs text-ink-soft">{formatDate(day)}</p>}
        </div>
        <button
          className="btn-ghost px-2.5 py-2"
          aria-label="اليوم التالي"
          disabled={day >= today}
          onClick={() => setDay((d) => shiftDay(d, 1))}
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {!level ? (
        <Empty title="لا مستوى في هذا اليوم" hint={emptyHint} />
      ) : rows.length === 0 ? (
        <Empty title={`${level.name} بلا أوراد بعد`} hint="يضيف المدير أو الشيخ عبادات هذا المستوى من تبويب «المستويات»." />
      ) : (
        <>
          <div className="mb-4 rounded-2xl bg-brand-900 p-5 text-white">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-sm text-gold-300">{level.name}</p>
              <p className="display text-3xl">
                {done}/{total}
              </p>
            </div>
            <Bar value={percent} />
          </div>

          {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

          <ul className="space-y-2">
            {rows.map(({ item, target, log, complete }) => (
              <li key={item.id} className={`card flex items-center gap-3 p-3.5 ${complete ? 'border-emerald-200 bg-emerald-50/40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.kind !== 'check' && (
                    <p className="text-xs text-ink-soft">
                      {target != null ? `الهدف ${target}${item.unit ? ` ${item.unit}` : ''}` : item.unit ?? ''}
                    </p>
                  )}
                </div>
                {item.kind === 'check' ? (
                  <button
                    onClick={() => void save(item.id, { done: !(log?.done === true) })}
                    aria-pressed={log?.done === true}
                    aria-label={`${item.name}: ${log?.done ? 'تم' : 'لم يتم'}`}
                    disabled={saving === item.id}
                    className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                      log?.done ? 'bg-emerald-600 text-white' : 'border border-line bg-white text-ink-soft hover:border-emerald-400'
                    }`}
                  >
                    <Check size={16} />
                    {log?.done ? 'تم' : 'لم يتم'}
                  </button>
                ) : (
                  <NumberStepper
                    label={item.name}
                    value={log?.value ?? null}
                    step={item.kind === 'count' ? 1 : 0.5}
                    onCommit={(v) => void save(item.id, { value: v })}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** عدّاد بأزرار −/+ وكتابة مباشرة؛ يحفظ بعد توقف قصير */
function NumberStepper({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number | null;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value == null ? '' : String(value));
  const timer = useRef<number>();

  useEffect(() => setLocal(value == null ? '' : String(value)), [value]);

  function set(v: string, immediate = false) {
    setLocal(v);
    const num = Number(v);
    if (v === '' || !Number.isFinite(num) || num < 0 || num > 100000) return;
    window.clearTimeout(timer.current);
    if (immediate) onCommit(num);
    else timer.current = window.setTimeout(() => onCommit(num), 500);
  }

  const cur = Number(local) || 0;
  return (
    <div className="flex items-center gap-1">
      <button
        className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-soft"
        aria-label={`إنقاص ${label}`}
        onClick={() => set(String(Math.max(0, cur - step)), true)}
      >
        <Minus size={15} />
      </button>
      <input
        className="field w-16 px-2 py-1.5 text-center"
        inputMode="decimal"
        aria-label={label}
        value={local}
        onChange={(e) => set(e.target.value)}
      />
      <button
        className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-soft"
        aria-label={`زيادة ${label}`}
        onClick={() => set(String(cur + step), true)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
