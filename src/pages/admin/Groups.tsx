import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { Chip, Empty, Loading, Sheet } from '@/components/ui';
import type { StudentGroup } from '@/lib/types';
import { loadGroups, loadStudents, type StudentLite } from './shared';

export default function Groups({ circleId }: { circleId: string }) {
  const [groups, setGroups] = useState<StudentGroup[] | null>(null);
  const [members, setMembers] = useState<{ group_id: string; student_id: string }[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([loadGroups(circleId), loadStudents(circleId)]);
    const ids = g.map((x) => x.id);
    const m = ids.length
      ? await fetchAll<{ group_id: string; student_id: string }>(
          () => supabase.from('student_group_members').select('group_id, student_id').in('group_id', ids),
          'student_id',
        )
      : [];
    setGroups(g);
    setStudents(s);
    setMembers(m);
  }, [circleId]);

  useEffect(() => {
    setGroups(null);
    void load();
  }, [load]);

  if (groups === null) return <Loading />;
  const open = groups.find((g) => g.id === openId) ?? null;

  return (
    <>
      <button className="btn-primary mb-4" onClick={() => setCreating(true)}>
        <Plus size={17} />
        مجموعة جديدة
      </button>

      {groups.length === 0 ? (
        <Empty
          icon={UsersRound}
          title="لا مجموعات بعد"
          hint="المجموعة (حلقة، دفعة، فصل) تسهّل ربط شيخ أو مسؤول بطلابها، وتعيين مستوى الأوراد لهم دفعة واحدة."
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {groups.map((g) => {
            const n = members.filter((m) => m.group_id === g.id).length;
            return (
              <button key={g.id} onClick={() => setOpenId(g.id)} className="card-link flex items-center gap-3 p-4 text-start">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-200">
                  <UsersRound size={20} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="text-xs text-ink-soft">{n} طالب</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {creating && (
        <NameSheet
          title="مجموعة جديدة"
          onClose={() => setCreating(false)}
          onSave={async (name) => {
            const { error } = await supabase.from('student_groups').insert({ circle_id: circleId, name });
            if (error) return dbMessage(error);
            setCreating(false);
            void load();
            return null;
          }}
        />
      )}

      {open && (
        <GroupSheet
          group={open}
          students={students}
          memberIds={new Set(members.filter((m) => m.group_id === open.id).map((m) => m.student_id))}
          onChanged={() => void load()}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function NameSheet({
  title,
  initial = '',
  onSave,
  onClose,
}: {
  title: string;
  initial?: string;
  onSave: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={title}>
      <label className="label" htmlFor="grp-name">الاسم</label>
      <input id="grp-name" className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <button
        className="btn-primary mt-4 w-full"
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          setErr(await onSave(name.trim()));
          setBusy(false);
        }}
      >
        حفظ
      </button>
    </Sheet>
  );
}

function GroupSheet({
  group,
  students,
  memberIds,
  onChanged,
  onClose,
}: {
  group: StudentGroup;
  students: StudentLite[];
  memberIds: Set<string>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(memberIds);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [filter, setFilter] = useState('');

  async function toggle(studentId: string) {
    setErr(null);
    const on = ids.has(studentId);
    const { error } = on
      ? await supabase.from('student_group_members').delete().eq('group_id', group.id).eq('student_id', studentId)
      : await supabase.from('student_group_members').insert({ group_id: group.id, student_id: studentId });
    if (error) return setErr(dbMessage(error));
    setIds((prev) => {
      const next = new Set(prev);
      if (on) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
    onChanged();
  }

  async function remove() {
    if (!confirm(`حذف مجموعة «${group.name}»؟ لا يُحذف أي طالب، لكن من رُبط بها يفقد نطاقه عليها.`)) return;
    const { error } = await supabase.from('student_groups').delete().eq('id', group.id);
    if (error) return setErr(dbMessage(error));
    onChanged();
    onClose();
  }

  const shown = students.filter((s) => !filter.trim() || s.full_name.includes(filter.trim()));

  return (
    <Sheet open onClose={onClose} title={group.name}>
      <div className="mb-4 flex items-center justify-between">
        <Chip tone="info">{ids.size} طالب</Chip>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setRenaming(true)}>
            إعادة تسمية
          </button>
          <button className="btn-ghost px-3 py-1.5 text-xs text-rose-700" onClick={() => void remove()}>
            <Trash2 size={14} />
            حذف
          </button>
        </div>
      </div>
      {err && <p className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{err}</p>}
      <input
        className="field mb-2"
        placeholder="بحث بالاسم"
        aria-label="بحث عن طالب"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {students.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-soft">لا طلاب في المجلس بعد.</p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {shown.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
                ids.has(s.id) ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'
              }`}
            >
              <input type="checkbox" className="accent-brand-700" checked={ids.has(s.id)} onChange={() => void toggle(s.id)} />
              {s.full_name}
            </label>
          ))}
        </div>
      )}
      <button className="btn-primary mt-5 w-full" onClick={onClose}>
        تم
      </button>

      {renaming && (
        <NameSheet
          title="إعادة تسمية"
          initial={group.name}
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            const { error } = await supabase.from('student_groups').update({ name }).eq('id', group.id);
            if (error) return dbMessage(error);
            setRenaming(false);
            onChanged();
            return null;
          }}
        />
      )}
    </Sheet>
  );
}
