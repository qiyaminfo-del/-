import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { Chip, Empty, Loading } from '@/components/ui';
import type { StudentGroup, StudentLevel } from '@/lib/types';
import { loadGroups, loadStudents, type StudentLite } from '../admin/shared';
import type { WirdCatalog } from './data';

/** تعيين المستوى لطالب أو مجموعة أو الجميع. النقل يحفظ السجل السابق. */
export default function StudentsLevels({
  circleId,
  catalog,
  onOpenStudent,
}: {
  circleId: string;
  catalog: WirdCatalog;
  onOpenStudent: (s: StudentLite) => void;
}) {
  const [students, setStudents] = useState<StudentLite[] | null>(null);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [members, setMembers] = useState<{ group_id: string; student_id: string }[]>([]);
  const [current, setCurrent] = useState<Map<string, string>>(new Map());
  const [groupFilter, setGroupFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [studs, grps, active] = await Promise.all([
      loadStudents(circleId),
      loadGroups(circleId),
      fetchAll<StudentLevel>(() =>
        supabase.from('student_levels').select('*').eq('circle_id', circleId).is('ended_at', null),
      ),
    ]);
    const ids = grps.map((g) => g.id);
    const m = ids.length
      ? await fetchAll<{ group_id: string; student_id: string }>(
          () => supabase.from('student_group_members').select('group_id, student_id').in('group_id', ids),
          'student_id',
        )
      : [];
    setStudents(studs);
    setGroups(grps);
    setMembers(m);
    setCurrent(new Map(active.map((a) => [a.student_id, a.level_id])));
  }, [circleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const inGroup = groupFilter ? new Set(members.filter((m) => m.group_id === groupFilter).map((m) => m.student_id)) : null;
    return (students ?? []).filter(
      (s) =>
        (!inGroup || inGroup.has(s.id)) &&
        (!levelFilter || (levelFilter === 'none' ? !current.has(s.id) : current.get(s.id) === levelFilter)),
    );
  }, [students, members, groupFilter, levelFilter, current]);

  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((s) => next.delete(s.id));
      else shown.forEach((s) => next.add(s.id));
      return next;
    });
  }

  async function assign() {
    setMsg(null);
    if (!target) return setMsg({ tone: 'bad', text: 'اختر المستوى.' });
    if (!selected.size) return setMsg({ tone: 'bad', text: 'حدد طالبًا واحدًا على الأقل.' });
    setBusy(true);
    const ids = [...selected];
    // دفعات صغيرة: الطلب الواحد محدود في القاعدة
    let moved = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await supabase.rpc('assign_level', { p_level: target, p_students: ids.slice(i, i + 500) });
      if (error) {
        setBusy(false);
        return setMsg({ tone: 'bad', text: dbMessage(error) });
      }
      moved += Number(data ?? 0);
    }
    setBusy(false);
    const name = catalog.levels.find((l) => l.id === target)?.name ?? '';
    setMsg({ tone: 'good', text: moved ? `نُقل ${moved} طالب إلى «${name}». سجلهم السابق محفوظ.` : `كلهم في «${name}» من قبل.` });
    setSelected(new Set());
    void load();
  }

  if (students === null) return <Loading />;
  if (!catalog.levels.length) return <Empty title="لا مستويات بعد" hint="أنشئ المستويات أولًا من تبويب «المستويات»." />;
  if (!students.length) return <Empty title="لا طلاب في نطاقك" hint="يظهر هنا الطلاب الذين أُسندوا إليك." />;

  const levelName = (id: string | undefined) => catalog.levels.find((l) => l.id === id)?.name;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <select className="field" aria-label="تصفية بالمجموعة" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">كل المجموعات</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select className="field" aria-label="تصفية بالمستوى" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="">كل المستويات</option>
          <option value="none">بلا مستوى</option>
          {catalog.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white/95 p-2.5 shadow-card backdrop-blur lg:top-2">
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="accent-brand-700" checked={allShownSelected} onChange={toggleAll} />
          الكل ({shown.length})
        </label>
        <span className="text-xs text-ink-faint">محدد: {selected.size}</span>
        <select className="field ms-auto w-auto min-w-40 py-2" aria-label="المستوى المستهدف" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">نقل إلى مستوى…</option>
          {catalog.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="btn-primary py-2" disabled={busy} onClick={() => void assign()}>
          {busy ? '…' : 'تعيين'}
        </button>
      </div>

      {msg && (
        <p
          role="status"
          className={`mb-3 rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset ${
            msg.tone === 'good' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'
          }`}
        >
          {msg.text}
        </p>
      )}

      <ul className="space-y-1.5">
        {shown.map((s) => (
          <li key={s.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${selected.has(s.id) ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'}`}>
            <input
              type="checkbox"
              className="accent-brand-700"
              aria-label={`تحديد ${s.full_name}`}
              checked={selected.has(s.id)}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                })
              }
            />
            <button className="min-w-0 flex-1 truncate text-start text-sm font-medium hover:text-brand-700" onClick={() => onOpenStudent(s)}>
              {s.full_name}
            </button>
            {current.has(s.id) ? <Chip tone="info">{levelName(current.get(s.id))}</Chip> : <Chip tone="warn">بلا مستوى</Chip>}
          </li>
        ))}
      </ul>
    </div>
  );
}
